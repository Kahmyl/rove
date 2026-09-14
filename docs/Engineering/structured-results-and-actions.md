# Structured Results and Actions

**Status:** Stable local Result records, exact Output context, immutable draft revisions, explicit Workflow-context promotion, and Runtime-correlated action outcomes are implemented foundations. The customer-facing Output projection described here is the approved target; automatic extraction of every Output and generalized artifact authoring are not claimed.

## Product boundary

Conversation remains the primary task surface. **Result** is an internal domain record; **Output** is the customer-facing projection of useful durable work from a task. A user can save a completed assistant response to Outputs in one action without choosing an internal kind, inventing a title, or re-entering its material. The host deterministically derives safe metadata while recording the task-owned Result ID, exact source item and text digest, and immutable revision. Saving the same source response again must not create a duplicate.

The task conversation does not display a second shelf of Result records. A compact marker on the exact source response acknowledges that it was saved and opens the Output. Workflow Home and Outputs project the same stable records with a recognizable title, preview, useful kind, source task, and customer-meaningful action state where applicable. Opening an Output stays inside the Workflow workspace on a real detail surface rather than using the source conversation as its only detail view.

Editable Outputs expose **Edit**. Saving creates a new immutable internal revision; stale expected revisions cannot overwrite newer work, while revision numbers and revision-operation language remain hidden from ordinary customer UI. **Continue in task** opens the source task, selects the exact stable Result revision for the next turn, and shows a quiet `Using: <Output>` composer chip. Selection stays local to the exact task and is described by its customer benefit rather than as Result selection.

The task composer sends at most eight internally selected Results through a bounded, digested context snapshot at a new turn boundary. The user message remains unchanged. The durable task event and outbox command record the exact selected IDs, revisions, content digests, lifecycle states, and injected instructions. Switching task views keeps unsent follow-up text task-keyed, and selection cannot resolve a Result from another task.

**Add to Context** reuses the existing explicit Workflow-promotion boundary. From inside a Workflow, the current Workflow is the implicit destination and ordinary review asks only what Rove should remember. The internal class uses the safest deterministic knowledge default; optional topic scope is progressively disclosed under Advanced. The host still verifies the exact task, Result identity, and current revision, hashes the approved body, and records Result-revision provenance beside the new immutable Workflow revision. It does not copy task history, action authority, attachments, browser state, or execution state into portable guidance. An Output remains an Output after promotion.

When an Output body begins with a Markdown heading that is semantically identical to its Output title, previews, detail, and editing suppress that duplicate heading. Comparison is case-insensitive and whitespace-normalized. This is a presentation rule: merely viewing or opening an editor does not rewrite stored content, and a genuinely different first heading remains visible.

## Action material and evidence

An authoritative proposed action records reviewed recipient, content, attachment IDs, target/resource, scope, and internal grounding details as one bounded material object with a SHA-256 digest. Referenced attachments must already belong to the exact task's scoped attachment authority. Customers review consequence and material, not accessible browser-control names, and cannot manually manufacture an Action through ordinary Save to Outputs. The Result begins `prepared`; assistant prose cannot advance it.

The Action Output translates internal lifecycle truth into consequence-oriented language without changing authority: `prepared` is **Ready for approval** and explicitly says nothing was sent; `authorized` is **Approved** but not confirmed complete; `dispatched` is **Checking outcome**; `confirmed` is **Sent** or **Completed**; `failed` is **Couldn't complete**; and `unresolved` is **Outcome unclear** with a warning not to retry blindly. Semantic success, warning, and danger treatments remain distinct from Rove's brand accent.

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
