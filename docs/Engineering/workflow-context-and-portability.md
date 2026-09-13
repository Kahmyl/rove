# Workflow Context and Portability

**Status:** Local Workflow setup, revisioning, explicit promotion, and turn-boundary context assembly are implemented. A strict provider-neutral portable projection, provider contract, tombstone semantics, and deterministic conflict planner are also implemented, but no production identity/provider is selected or connected. Portable synchronization remains unavailable and is deliberately not task, browser, or credential synchronization.

## Current local implementation

The companion stores Workflow identities and immutable approved configuration revisions in the existing task-engine SQLite database. The current local domain supports purpose, preferences, criteria, guidance, procedures, descriptive resource requirements, result conventions, and approved knowledge. These fields remain editable as optional Context/settings rather than prerequisites for creating the named workspace. Local workflows and task history remain inspectable while Codex is signed out. Archive is reversible; it does not delete associated tasks.

Task association is separate from disclosure. When starting a Workflow task, the user must explicitly choose whether relevant approved Workflow text may be sent to Codex or whether the association stays local only. For shared tasks, launch and each later idle-turn request assemble only applicable topic-scoped entries and record the exact revision and digest in the durable task event/outbox command. Steering an already-active turn does not change its context mid-action. A later approved edit or promotion can therefore apply at the next turn boundary without rewriting historical task or approval truth.

Save to Workflow identifies one attachment-free task conversation item, shows editable proposed reusable text and a destination/category, and stores local source task/item/digest provenance. It does not copy the conversation, attachments, approvals, credentials, browser state, or execution state. The provider-neutral boundary validates the same allowlist and defines owner-scoped compare-and-set writes, idempotent operations, tombstone/non-resurrection semantics, bounded stable pagination, cursor invalidation with authoritative refresh, and explicit upload/download/conflict plans. Local persistence of sync cursors, a real Rove identity, a production provider, cross-device UI, and deployed recovery remain unimplemented.

## Approved environment

A workflow is valid with only a name. It may additionally contain purpose, user-provided background relevant to the work, preferences, exclusions, reusable procedures/skills, result conventions, non-secret connection requirements, resource requirements, and explicitly approved reusable knowledge. It may contain many local tasks and project their stable Results and task-owned attention without uploading those local entities.

Progressive setup occurs after entry from a full secondary Context/settings workspace surface. The default state presents approved context in readable human language; one focused section enters edit mode at a time, while advanced fields remain available behind deliberate disclosure. Existing immutable configuration revisions remain the only persistence model. Future assistance may ask relevant questions or propose improvements with explicit approval. Structured fields store actual approved answers; a generated prose prompt is a derived view, not the only source of truth. Configuration never gates access to Home or ordinary task creation.

Keep four sources distinguishable: approved workflow guidance, the current task request, observed evidence, and proposed learning. Model-generated improvements require approval before becoming permanent. A change of topic in one task does not modify the shared workflow.

## Portable document shape

```json
{
  "workflowId": "workflow_opaque",
  "revision": 12,
  "name": "Job Search",
  "purpose": "Find and pursue suitable roles",
  "preferences": { "roleFamilies": ["backend engineering"] },
  "exclusions": [],
  "guidance": [],
  "skills": [],
  "resultConventions": { "includeSource": true },
  "connectionRequirements": [{ "kind": "email", "label": "Outreach account" }],
  "resourceRequirements": [{ "kind": "document", "label": "Current CV" }],
  "approvedKnowledge": []
}
```

This example is a design shape, not a finalized serialized API schema. `revision` is concurrency/history metadata, not a product version. Resource and connection requirements are descriptive references, not paths, tokens, or file bytes. Skills contain permitted procedural content, not arbitrary executable packages silently installed on another device.

Reject unrecognized secret or execution-state fields. The allowlist excludes task IDs/content, message history, results, recordings, screenshots, attachment bytes, cookies, tokens, local paths, page references, process identity, and operation/approval state. A useful non-secret fact may be intentionally promoted from a task only through user-visible selection and approval.

## Context assembly

At a turn boundary, assemble Rove's operating/permission rules, the relevant approved workflow revision, the current task request and conversation context, selected results, authorized local resources, and appropriate procedural references. Record the applied revision/digest locally.

Mandatory rules remain available. Large references and optional skills load according to relevance instead of copying every prior task into every prompt. A workflow's outreach style applies to outreach; it must not distort an unrelated explanation. A skill is guidance, not a permission grant. The [Agent Skills specification](https://agentskills.io/specification) is an optional packaging convention for procedures.

An edit does not alter a turn mid-action. Apply the new approved revision to a subsequent turn or an explicit user-directed context refresh, with the new snapshot recorded. Do not silently merge facts observed on a website into permanent user preferences.

## Synchronization protocol

The authenticated owner creates or reads an owner-scoped workflow document. A write sends the new approved configuration, a stable operation ID, and the expected remote revision. The service atomically validates ownership, schema, and expected revision, then returns the accepted revision. The same operation ID cannot commit two different payloads.

If the expected revision is stale, return conflict with the current revision and preserve the local edit. For this MVP, present an explicit choice to keep local, keep remote, or create a separate workflow copy. Do not build a CRDT or silently choose by wall-clock time. A chosen replacement is submitted against the newly observed revision.

Offline edits remain local pending configuration updates. Coalescing superseded unsent edits is acceptable if the final approved configuration and acknowledged base remain clear. Reconnect synchronizes setup only; it never dispatches tasks or grants permissions.

For deletion, use a tombstone or equivalent deletion cursor. An offline client cannot recreate the same workflow from an old revision. If the service compacts tombstones, invalidate old cursors and require a complete authoritative refresh that still rejects stale writes. Re-creation is an explicit new workflow identity. Conflict handling must not silently delete local task history.

## Local behavior

Cached approved guidance remains usable during service outages. Show whether configuration is synchronized, pending, conflicted, or unavailable. A failed remote write does not mean local tasks failed. A task pins enough context to explain historical results after a workflow is edited or removed.

On a new device, restore setup, show missing connections/resources, and require authorized reconnection or file selection. Never pretend a restored label is a usable credential or local file. Starting new local tasks does not import conversations from another device.

## Save to workflow

Present the exact proposed reusable information and its destination. Let the user edit or cancel it. Exclude attachments and conversation history by default. Retain a local provenance reference where useful, without introducing a portable link that falsely promises remote access to the original task.

Approved knowledge remains editable/removable. Saving guidance is not permission to contact a recipient, upload a résumé, or use an account. Those permissions remain local and action-specific.

## Provider acceptance

A provider must demonstrate owner isolation, conditional updates, idempotent writes, offline conflict recovery, deletion convergence, export, account deletion, and realistic quotas. It is not necessary to deploy a general row-sync platform. The particular provider remains unselected; this contract deliberately prevents that choice from expanding scope to cloud task storage. The [Workflow Portability Decision](workflow-portability-decision.md) records the exact authority decision, recommendation, alternatives, current provider-neutral implementation, and work remaining after selection.

Test two devices editing the same revision, an offline edit after deletion, expired cursors, sign-out/account switch, secret-field rejection, missing local resources, and a remote update arriving during an active turn. In every case, configuration synchronization must produce zero model or external-action dispatches.
