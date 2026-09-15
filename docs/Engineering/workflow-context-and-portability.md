# Workflow Context and Portability

**Status:** Local Workflow setup, revisioning, explicit promotion, and turn-boundary context assembly are implemented. Supabase Auth plus PostgreSQL/RLS is the approved provider boundary, and the desktop adapter, encrypted local session handling, owner-partitioned synchronization ledger, portable export, tombstones, and conflict UI are implemented. The provider migration and synchronization protocol are qualified deterministically against local PostgreSQL. Live Frankfurt Supabase, real OAuth/OTP, two packaged clients, provider pause/recovery, and packaged deep-link behavior remain qualification work; synchronization is deliberately not task, browser, credential, approval, or execution-state synchronization.

## Current local implementation

The companion stores Workflow identities and immutable approved configuration revisions in the existing task-engine SQLite database. The renderer uses guided fields for purpose, preferences, criteria, guidance, procedures, descriptive resource requirements, result conventions, and approved knowledge. Local workflows and task history remain inspectable while Codex is signed out. Archive is reversible; it does not delete associated tasks.

Task association is separate from disclosure. When starting a Workflow task, the user must explicitly choose whether relevant approved Workflow text may be sent to Codex or whether the association stays local only. For shared tasks, launch and each later idle-turn request assemble only applicable topic-scoped entries and record the exact revision and digest in the durable task event/outbox command. Steering an already-active turn does not change its context mid-action. A later approved edit or promotion can therefore apply at the next turn boundary without rewriting historical task or approval truth.

Save to Workflow identifies one attachment-free task conversation item, shows editable proposed reusable text and a destination/category, and stores source task/item/digest provenance only in the local task database. It does not copy that provenance, the conversation, attachments, approvals, credentials, browser state, or execution state into the portable projection. The Supabase boundary independently validates the exact allowlist and server digest, and defines owner-scoped compare-and-set writes, durable idempotent operations, tombstone/non-resurrection semantics, snapshot-stable pagination, cursor invalidation with authoritative refresh, and explicit upload/download/conflict states. Owner-bound incremental cursors advance only after corresponding local reconciliation succeeds. Local sync cursors, owner bindings, pending operations, distinct authentication/outage/transport-uncertainty failure state, account switching, owner-scoped export, and cloud-account deletion are implemented. Deployment-backed recovery and cross-device qualification remain pending.

## Approved environment

A workflow contains purpose, user-provided background relevant to the work, preferences, exclusions, reusable procedures/skills, result conventions, non-secret connection requirements, resource requirements, and explicitly approved reusable knowledge. It may contain many local tasks without uploading those tasks.

Guided setup asks relevant selectable questions with custom input and skip/not-sure paths. Users can inspect and edit the resulting guidance. Structured fields store actual answers; a generated prose prompt is a derived view, not the only source of truth.

Keep four sources distinguishable: approved workflow guidance, the current task request, observed evidence, and proposed learning. Model-generated improvements require approval before becoming permanent. A change of topic in one task does not modify the shared workflow.

## Portable document shape

```json
{
  "schemaVersion": 1,
  "workflowId": "workflow_opaque00000000",
  "configurationRevision": 12,
  "name": "Job Search",
  "archived": false,
  "configuration": {
    "purpose": "Find and pursue suitable roles",
    "preferences": [],
    "criteria": [],
    "guidance": [],
    "procedures": [],
    "resourceRequirements": [
      { "id": "resource_cv", "kind": "document", "label": "Current CV" }
    ],
    "resultConventions": [],
    "approvedKnowledge": []
  },
  "digest": "sha256-of-the-approved-portable-fields",
  "approvedAt": "2026-09-13T12:00:00.000Z"
}
```

This is the version-one serialized shape. `configurationRevision` is concurrency/history metadata, not a product version. Resource requirements are descriptive references, not paths, tokens, file bytes, or usable connections. Guidance arrays contain only bounded `{id, text, appliesTo}` entries. The server rejects unknown fields at every nested level and recomputes the digest before accepting a write.

Reject unrecognized secret or execution-state fields. The allowlist excludes task IDs/content, message history, results, recordings, screenshots, attachment bytes, cookies, tokens, local paths, page references, process identity, and operation/approval state. A useful non-secret fact may be intentionally promoted from a task only through user-visible selection and approval.

## Context assembly

At a turn boundary, assemble Rove's operating/permission rules, the relevant approved workflow revision, the current task request and conversation context, selected results, authorized local resources, and appropriate procedural references. Record the applied revision/digest locally.

Mandatory rules remain available. Large references and optional skills load according to relevance instead of copying every prior task into every prompt. A workflow's outreach style applies to outreach; it must not distort an unrelated explanation. A skill is guidance, not a permission grant. The [Agent Skills specification](https://agentskills.io/specification) is an optional packaging convention for procedures.

An edit does not alter a turn mid-action. Apply the new approved revision to a subsequent turn or an explicit user-directed context refresh, with the new snapshot recorded. Do not silently merge facts observed on a website into permanent user preferences.

## Synchronization protocol

The authenticated owner creates or reads an owner-scoped workflow document. A write sends the new approved configuration, a durable stable operation ID, and the expected remote revision. The service atomically validates authenticated ownership, the exact nested schema, the server-computed digest, and expected revision, then returns the accepted revision. The same operation ID cannot commit two different payloads. First creation is conditional and cannot become an overwrite when two devices race.

If the expected revision is stale, return conflict with the current revision and preserve the local edit. For this MVP, present an explicit choice to keep local, keep remote, or create a separate workflow copy. Do not build a CRDT or silently choose by wall-clock time. A chosen replacement is submitted against the newly observed revision.

Offline edits remain local pending configuration updates. Coalescing superseded unsent edits is acceptable if the final approved configuration and acknowledged base remain clear. Reconnect synchronizes setup only; it never dispatches tasks or grants permissions.

For deletion, the device persists an owner-bound removal operation before network dispatch and the server supplies the authoritative tombstone time. “Remove from Rove account” deletes only the cloud copy and detaches synchronization; the device-local Workflow and all task history remain. After provider confirmation, pending-operation removal, binding detachment, and local acknowledgement commit in one SQLite transaction. Pending writes and removals retain their stable operation identity, reviewed snapshot, owner, and acknowledged base across restart and response uncertainty. “Keep both” atomically creates exactly one idempotently identified local copy while applying the cloud configuration to the original. An offline client cannot recreate the same workflow from an old revision. After 30 days, compaction removes all history and operation results for the identity, advances the cursor floor, and retains a minimal owner-scoped hash fence against resurrection. Re-creation requires an explicit new workflow identity. Conflict handling never deletes local task history.

The local synchronization ledger stores device-local Workflow identity separately from the owner-scoped cloud identity. This prevents an account switch from transferring ownership and permits two owners whose portable Workflows have the same cloud identity to coexist as distinct local Workflows. Pending operations remain keyed to the original owner and cloud identity; sign-out, session change, account switch, and account deletion invalidate in-flight fences before later responses can mutate local synchronization state.

## Local behavior

Cached approved guidance remains usable during service outages. Show whether configuration is synchronized, pending, conflicted, or unavailable. A failed remote write does not mean local tasks failed. A task pins enough context to explain historical results after a workflow is edited or removed.

On a new device, restore setup, show missing connections/resources, and require authorized reconnection or file selection. Never pretend a restored label is a usable credential or local file. Starting new local tasks does not import conversations from another device.

## Save to workflow

Present the exact proposed reusable information and its destination. Let the user edit or cancel it. Exclude attachments and conversation history by default. Retain a local provenance reference where useful, without introducing a portable link that falsely promises remote access to the original task.

Approved knowledge remains editable/removable. Saving guidance is not permission to contact a recipient, upload a résumé, or use an account. Those permissions remain local and action-specific.

## Provider acceptance

A provider must demonstrate owner isolation, conditional updates, idempotent writes, offline conflict recovery, deletion convergence, export, account deletion, and realistic quotas. Supabase Auth plus PostgreSQL/RLS is selected; the local PostgreSQL harness proves the migration, grants/RLS, direct RPC boundary, CAS races, pagination, tombstones, purge, and account deletion without pretending to prove the Supabase gateway or real JWT lifecycle. It is not necessary to deploy a general row-sync platform. The [Workflow Portability Decision](workflow-portability-decision.md) records the authority decision, alternatives, implemented adapter, and remaining live qualification.

Test two devices editing the same revision, an offline edit after deletion, expired cursors, sign-out/account switch, secret-field rejection, missing local resources, and a remote update arriving during an active turn. In every case, configuration synchronization must produce zero model or external-action dispatches.
