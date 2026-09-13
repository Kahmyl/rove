# Events and Live State

**Status:** Target delivery and projection rules. This is a local application contract, not a distributed realtime infrastructure requirement.

## Three kinds of state

Durable product facts include accepted task requests, confirmed message items, attention transitions, operation outcomes, result references, artifact availability, and approved workflow changes. They must survive the interruption scenarios they claim to cover.

Ephemeral presentation includes token deltas, temporary progress text, cursor position, selected task, visible page, and component connectivity. Persist only what is needed for useful history and recovery. Do not write every streaming token as a separate full task snapshot.

External observations are facts from Codex, the browser, or an integration. Validate and correlate them before using them to change product state. An external event is not an authorization to execute a new action.

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

## Initial snapshot and resubscription

A subscriber obtains a snapshot with a cursor/revision and then receives later changes without a lost-update gap. Implement this with an atomic snapshot/subscription boundary, or register the listener and re-query before accepting the cursor. The current lost-wakeup-safe patterns may be reused.

On reconnect, request changes after the last applied cursor. If retention or restart invalidates that cursor, return an explicit resnapshot requirement. Do not silently skip missing changes. Apply duplicate notifications idempotently; ignore stale entity revisions while still recording meaningful unmatched diagnostics.

Renderers never replay user commands merely because they rebuilt their view. User-command acceptance and subscription state are independent. A UI retry button consults the known operation state rather than issuing a fresh side effect by default.

## Attention and control events

Attention events identify the exact request generation and whether it remains actionable. A stale dialog cannot respond to a newer request with similar text. Resolution, cancellation, expiry, and supersession are distinguishable and remove obsolete controls.

Control transfer is represented after the underlying ownership boundary has changed. A request to take control is not yet evidence that control was acquired. Returning control emits current-state information sufficient for fresh agent grounding, not an instruction to replay an earlier click.

Task needs-attention badges may aggregate in the navigation UI without globally blocking other tasks. Notification count and currently selected task are not approval authority.

## Resource and artifact events

Recording-started, recording-stopped, finalizing, artifact-available, and artifact-failed are separate facts. Only artifact-available means the file can be opened. A browser crash or disk-full condition must not leave a false saved-video result.

The implemented page-video path persists these lifecycle facts before projecting them into the product surface. Recording observations carry task, session, recording, page, and state identity but never captured frame bytes or sensitive form values. Restart recovery converts unfinished records to an explicit interrupted failure; it does not infer availability from the presence of a staging file.

A download or generated file publishes a managed reference after storage availability and metadata validation. Large byte payloads do not travel through every task snapshot. Readers request bytes separately through the authorized artifact boundary.

## Synchronization events

Workflow configuration changes can notify other devices to fetch newer approved revisions. Those notifications do not include local task history and cannot contain executable operations. An applied remote revision updates setup and UI; it never starts a model turn, resolves an approval, or repeats a browser action.

Transient sync failure produces an explicit pending/conflict state while local approved guidance remains usable. Do not represent a last-known configuration as freshly synchronized unless acknowledgement confirms it.

## Backpressure and recovery

Coalesce expendable progress updates while retaining final message items, errors, attention changes, and operation outcomes. Bound subscriptions and event buffers. When a consumer falls behind, require a resnapshot rather than growing memory without limit.

After restart, recover unfinished operation facts before presenting running states. Replay of persisted facts rebuilds projections only. External effects require a separate dispatch decision with current authority. This distinction must be tested with duplicate, late, missing, and reordered events.

## Acceptance

Verify view switching during streaming, disconnect between snapshot and subscription, duplicate terminal events, stale attention responses, cursor expiration, engine reconnection, browser restart, file finalization failure, and downloaded workflow revisions. Every case must preserve exact task association and prevent effect execution from read-side replay.
