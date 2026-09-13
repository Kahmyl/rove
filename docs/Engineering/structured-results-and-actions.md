# Structured Results and Actions

**Status:** Stable local results, selected-result follow-up, immutable draft revisions, exact Workflow promotion, and Runtime-correlated action outcomes are implemented. Automatic extraction of every result and generalized artifact-result creation are not claimed.

## Product boundary

Conversation remains the primary task surface. A user explicitly saves a completed assistant response when it is useful as a stable finding collection, draft, report, journey, or proposed action. Saving records a task-owned result ID, exact source item and text digest, and immutable revision. Draft edits create a new revision; stale expected revisions cannot overwrite newer work. Selection is durable but remains local to the exact task.

The task composer sends at most eight selected results through a bounded, digested context snapshot at a new turn boundary. The user message remains unchanged. The durable task event and outbox command record the exact selected IDs, revisions, content digests, lifecycle states, and injected instructions. Switching task views keeps unsent follow-up text task-keyed, and selection cannot resolve a result from another task.

Save to Workflow reuses the existing explicit promotion boundary. The host verifies the exact task, result identity, and current revision, hashes the full result body, and records result-revision provenance beside the new immutable Workflow revision. It does not copy task history, action authority, attachments, browser state, or execution state into portable guidance.

## Action material and evidence

A proposed action records reviewed recipient, content, attachment IDs, target/resource, scope, and the exact accessible names of the recipient, content, attachment, and commit controls as one bounded material object with a SHA-256 digest. Referenced attachments must already belong to the exact task's scoped attachment authority. The result begins `prepared`; assistant prose cannot advance it.

Authorization is an explicit renderer action and is durable even when the task has no browser session. It authorizes only the saved material; it does not by itself grant a browser commit. When execution is requested, the agent may stage ordinary form fields, but it must not upload a file before an exact upload plan is authorized. Runtime prepares a concrete, non-dispatching plan that snapshots the exact page revision, distinct field target names and values, immutable file evidence IDs and hashes, commit target, low-level commit action, and expected effects. The plan remains `planned` and cannot dispatch.

The Companion activates that plan only when its observed recipient/content/files/target/scope and concrete control names exactly match the task-owned saved material. Runtime then records the plan as `authorized`. A task-result browser commit must present the exact consequence key, material digest, and opaque plan ID; Runtime rechecks the unchanged page revision, bound field values, commit action, and expected effects immediately before advancing the journal to `prepared`, the possible-dispatch boundary. Changed material, target, controls, files, page revision, or evidence rejects before dispatch and requires a new plan. The first disclosure of an attachment must be the exact upload action itself. A later send or submit may carry the attachment only when Runtime can link the current control's filename and SHA-256 to that applied upload plan and receipt; the provenance is persisted in the final plan and rechecked immediately before dispatch. The same semantic authorization may validate a replacement plan only while the prior plan has not crossed the dispatch boundary.

`planned` and `authorized` do not fence other work. An unresolved task-result operation fences only that exact consequence identity and does not block unrelated result or ordinary operations in the same browser workspace. Existing non-result legacy uncertainty retains its conservative workspace behavior.

The companion reconciles only that exact session/key:

| Runtime truth                            | Local action result                    |
| ---------------------------------------- | -------------------------------------- |
| concrete `planned` awaiting host match   | `authorized`, but not dispatchable     |
| exact plan `authorized`                  | `authorized`                           |
| `prepared` after a possible interruption | `unresolved`                           |
| `applied` with receipt/evidence          | durable `dispatched`, then `confirmed` |
| `not_applied`                            | `failed`                               |
| `unresolved`                             | `unresolved`                           |

Confirmed, failed, and unresolved states are not inferred from model text. An unresolved action cannot be selected as fresh dispatch authority, while later authoritative evidence may still resolve it to confirmed or failed. Runtime's existing effect journal and replay fence remain the external consequence authority; the result tables are the user-facing local projection.

## Persistence and limits

Migration `0004_add_task_results` adds `task_result`, `task_result_revision`, `task_result_operation`, and `workflow_result_promotion_provenance` to the existing task-engine SQLite database. Foreign keys retain exact task/result/revision ownership. Operation IDs are idempotent and conflict if reused with changed input. Result and selection state recover from the same database after restart.

Artifact IDs are bounded references only. The result model does not grant arbitrary filesystem paths, copy original files, or replace existing attachment/evidence ownership. Manual artifact-result creation is intentionally not exposed until the existing managed artifact authority can supply a verified artifact identity end to end.
