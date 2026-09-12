# Workflow Context and Portability

**Status:** Target contract for reusable setup. This is deliberately not task, browser, or credential synchronization.

## Approved environment

A workflow contains purpose, user-provided background relevant to the work, preferences, exclusions, reusable procedures/skills, result conventions, non-secret connection requirements, resource requirements, and explicitly approved reusable knowledge. It may contain many local tasks without uploading those tasks.

Guided setup asks relevant selectable questions with custom input and skip/not-sure paths. Users can inspect and edit the resulting guidance. Structured fields store actual answers; a generated prose prompt is a derived view, not the only source of truth.

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

A provider must demonstrate owner isolation, conditional updates, idempotent writes, offline conflict recovery, deletion convergence, export, account deletion, and realistic quotas. It is not necessary to deploy a general row-sync platform. The particular provider remains unselected; this contract deliberately prevents that choice from expanding scope to cloud task storage.

Test two devices editing the same revision, an offline edit after deletion, expired cursors, sign-out/account switch, secret-field rejection, missing local resources, and a remote update arriving during an active turn. In every case, configuration synchronization must produce zero model or external-action dispatches.
