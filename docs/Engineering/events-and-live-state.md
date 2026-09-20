# Events and Live State

**Status:** Target delivery and projection rules. This is a local application contract, not a distributed realtime infrastructure requirement.

## Three kinds of state

Durable product facts include accepted user conversation items and their delivery states, ordered queued follow-ups, confirmed provider materialization, local Task-history archive preferences, attention transitions, operation outcomes, result references, artifact availability, and approved workflow changes. They must survive the interruption scenarios they claim to cover. Codex thread archival and absence are external observations, not local Task-organization facts.

Durable acceptance creates exactly one accepted user conversation item without waiting for App Server `userMessage` history. That item is immediately renderable, owns stable client/operation identity and delivery state, and remains the same item through definite non-submission or uncertain delivery. The exact later live/history item reconciles it and may advance delivery evidence; it never replaces it or appends a duplicate. A queued follow-up is durable Task state but is not conversation truth, an execution turn, or an external submission. At the committed execution boundary, promotion atomically turns that exact queued instruction into the accepted user conversation item. Restart replay restores an unpromoted queue without dispatching it.

Ephemeral presentation includes token deltas, temporary progress text, cursor position, selected task, visible page, open/collapsed history choices, anti-flicker timing, and component connectivity. Persist only what is needed for useful history and recovery. Do not write every streaming token as a separate full task snapshot. Intermediate semantic activity may be coalesced or reconstructed where final durable truth is sufficient, but consequential state, failure, and uncertainty remain durable as required by their owning contract.

External observations are facts from Codex, the browser, or an integration. Validate and correlate them before using them to change product state. An external event is not an authorization to execute a new action.

For the Codex adapter, qualified exact `thread/read` history is the resnapshot source for reconstructible turn, item, message-correlation, tool, and completed request-human facts. Live notifications and history observations enter the same Task reducer with stable semantic identities. Durable recovery blockers retain their authority class and exact correlation: a history success clears only thread-history uncertainty. Normal thread history does not reconstruct outstanding server-request attention or provider archive membership, so those families remain independently generation-fenced and fail-closed rather than inferred from nearby prose. Intermediate progress/delta delivery is presentation-only when terminal history is sufficient.

## Logical event shape

```json
{
  "eventId": "evt_opaque",
  "sequence": 412,
  "entity": { "kind": "task", "id": "task_opaque", "revision": 18 },
  "type": "result.available",
  "operationId": "op_opaque",
  "observedAt": "2026-09-12T12:00:00Z",
  "payload": { "resultId": "result_opaque" }
}
```

The example is a target shape. Identity, sequence, entity revision, and correlation are separate. Arrival time is not a trustworthy ordering key for external effects. Schema/protocol compatibility identifiers may be retained where required; they are not product release labels.

## Publication and ordering

Commit the authoritative local change before publishing its notification. Within a task, serialize state reduction so a later item cannot overwrite a newer outcome with stale data. Deduplicate external events using supported event/item identity and connection generation; do not assume transport delivery is exactly once.

The application service may publish a bounded change feed or invalidate a snapshot through the existing subscription seam. A durable local change table is useful where it solves reconnection or crash boundaries, but is not mandatory duplication of the existing task ledger. Choose one authority and derive views from it.

Streaming deltas carry exact task, turn, and item association. A component switching views unsubscribes or changes its displayed selector; it does not alter the producer's task association. A late delta for an interrupted turn cannot activate a new turn or append to another task.

Customer active-work state is derived from the combination of accepted work, current exact turn/dispatch facts, waiting and attention state, browser ownership, stopping intent, and recovery blockers. It does not blindly mirror one stale provider `turnStatus`. Active-duration intervals open and close from that customer projection; waiting for the user, human ownership, checking/recovery, stopping, and stopped time do not accumulate.

## Initial snapshot and resubscription

A subscriber obtains a snapshot with a cursor/revision and then receives later changes without a lost-update gap. Implement this with an atomic snapshot/subscription boundary, or register the listener and re-query before accepting the cursor. The current lost-wakeup-safe patterns may be reused.

On reconnect, request changes after the last applied cursor. If retention or restart invalidates that cursor, return an explicit resnapshot requirement. Do not silently skip missing changes. Apply duplicate notifications idempotently; ignore stale entity revisions while still recording meaningful unmatched diagnostics.

Renderers never replay user commands merely because they rebuilt their view. User-command acceptance and subscription state are independent. A UI retry button consults the known operation state rather than issuing a fresh side effect by default.

## Attention and control events

Attention events identify the exact request generation and whether it remains actionable. A stale dialog cannot respond to a newer request with similar text. Resolution, cancellation, expiry, and supersession are distinguishable and remove obsolete controls.

Control transfer is represented after the underlying ownership boundary has changed. A request to take control is not yet evidence that control was acquired. Returning control emits current-state information sufficient for fresh agent grounding, not an instruction to replay an earlier click.

Task needs-attention badges may aggregate in the navigation UI without globally blocking other tasks. Notification count and currently selected task are not approval authority.

## Outcome reconciliation

A consequential operation that may have dispatched keeps its exact operation and consequence identity while evidence is incomplete. Presentation may show **Checking outcome** while the owning capability performs bounded read-only reconciliation. Those reads are correlated observations of the existing operation, not new authorization and not a replayable mutation command.

Reconciliation may publish bounded progress/observation facts when useful, but durable product state changes only when authoritative evidence settles the operation or when the operation is explicitly recorded as still unresolved. A fresh page snapshot, screenshot, search result, activity view, or other external observation cannot by itself authorize another effect.

Late evidence may settle an existing unverified operation only when it is correlated to the correct task, resource, operation/consequence identity, and required outcome. Unrelated observations cannot erase a replay fence. Renderer reconnection, task switching, or application restart rebuilds reconciliation presentation from authoritative local facts and never manufactures another dispatch.

## Resource and artifact events

Recording-started, recording-stopped, finalizing, artifact-available, and artifact-failed are separate facts. Only artifact-available means the file can be opened. A browser crash or disk-full condition must not leave a false saved-video result.

The implemented page-video path persists these lifecycle facts before projecting them into the product surface. Recording observations carry task, session, recording, page, and state identity but never captured frame bytes or sensitive form values. Restart recovery converts unfinished records to an explicit interrupted failure; it does not infer availability from the presence of a staging file.

A download or generated file publishes a managed reference after storage availability and metadata validation. Large byte payloads do not travel through every task snapshot. Readers request bytes separately through the authorized artifact boundary.

## Synchronization events

Workflow configuration changes can notify other devices to fetch newer approved revisions. Those notifications do not include local task history and cannot contain executable operations. An applied remote revision updates setup and UI; it never starts a model turn, resolves an approval, or repeats a browser action.

Transient sync failure produces an explicit pending/conflict state while local approved guidance remains usable. Do not represent a last-known configuration as freshly synchronized unless acknowledgement confirms it.

## Backpressure and recovery

Coalesce expendable progress updates while retaining final message items, errors, attention changes, and operation outcomes. Bound subscriptions and event buffers. When a consumer falls behind, require a resnapshot rather than growing memory without limit.

After restart, recover unfinished operation facts before presenting running states. Replay of persisted facts and queued follow-ups rebuilds projections only. External effects and queue promotion require a separate dispatch decision with current authority. This distinction must be tested with duplicate, late, missing, and reordered events.

An unresolved command retains its exact operation identity until matching delivery or non-submission evidence resolves it. Unrelated observations cannot erase that fence. This operation-level recovery state does not delete or hide the durable conversation, and completed cleanup reopens normal message flow rather than producing a terminal Task.

## Acceptance

Verify view switching during streaming, disconnect between snapshot and subscription, duplicate terminal events, stale attention responses, cursor expiration, engine reconnection, browser restart, file finalization failure, and downloaded workflow revisions. Every case must preserve exact task association and prevent effect execution from read-side replay.
