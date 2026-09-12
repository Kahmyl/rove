# Phase 5 P5.9 native lifecycle convergence

Date: 2026-09-08

Status: **L0 and L1 accepted by the Master Engineering Agent; L2 locally passed
and awaits independent acceptance; P5.9 live acceptance and the final packaged
release gate remain open.**

## Outcome

Before more external-service acceptance, Rove must replace its split task/session
lifecycle with one durable product lifecycle. The replacement spans Runtime,
Companion, `LocalProductApi`, persistence, recovery, and the unified renderer. It
is not a correction for one missing button.

The implementation is divided into four consecutive gates:

1. **L0 — executable lifecycle contract:** build a deterministic reducer/oracle
   and crash-transition campaign without contacting external services.
2. **L1 — production convergence:** connect Runtime inventory, task lifecycle,
   cleanup recovery, product projection, and renderer actions to that contract.
3. **L2 — local recovery qualification:** exercise real source/production-process
   restarts and cleanup locally before P5.9 live acceptance resumes. Iterate in
   this fast local loop until the lifecycle and live journeys are accepted.
4. **Final packaged release gate:** package once, after local P5.9 acceptance,
   then repeat a concise startup, recovery, and cleanup confirmation against the
   exact distributable.

The implementation task may prepare evidence for each gate. Only the Master
Engineering Agent may accept the gate.

## Confirmed root cause

The current product derives whether a task is active through an inconsistent
chain:

1. `LocalProductApi.readSnapshot()` asks
   `RoveTaskCoordinator.activeRuntimeTaskId()` for one active task.
2. That method asks Runtime for its active sessions.
3. `RuntimeService.listActiveSessions()` starts from
   `BrowserService.sessionIds()`, which contains only browser objects attached
   to the current Runtime process.
4. Restart recovery instead calls `getSession()` for the persisted session
   record. That record can still say `active` when its browser object disappeared
   with the previous process.

The resulting state is internally contradictory: recovery accepts the persisted
session, while the active-session query omits it. The renderer then labels the
task as historical, removes live controls, and cannot complete cleanup even
though durable task and Runtime records remain.

This is a structural mismatch between five facts:

- the persisted Rove task association;
- the persisted Runtime session record;
- the browser host attached to the current Runtime process;
- the Codex thread and turn state;
- pending continuation and attention state.

No one of those facts is the product lifecycle by itself. In particular, Codex
thread completion does not prove that a browser session is closed, and a missing
in-memory browser does not prove that a durable Runtime session is closed.

## Locked authority model

The trusted Desktop host owns the product lifecycle and convergence workflow.
Other components retain their narrower authority:

- Codex App Server owns account, thread, turn, item, and approval state.
- Runtime owns persisted browser-session state, live browser attachment,
  workspace/profile ownership, control, observations, and evidence.
- Companion owns the user task intent, the task-to-thread-to-session association,
  close intent, and convergence progress.
- The renderer presents a validated projection. It never infers lifecycle or
  permitted actions from row selection, turn text, or a missing query result.

This follows the App Server separation between `thread/read`, `thread/resume`,
thread runtime status, turn completion, and archival. App Server state is an
input to Rove's lifecycle reconciliation, not a substitute for it.

## Durable product record

Replace the bootstrap-only task context with a versioned task lifecycle record.
The exact persisted representation may be refined during L0, but it must carry
these concepts and validate them strictly:

```text
TaskLifecycleRecord
  schemaVersion
  immutable identity and frozen launch selection
  bootstrap workflow
  desiredState: open | closed
  closeOperation?:
    operationId
    requestedAt
    stage:
      requested
      codex_settled
      continuation_settled
      runtime_settled
      complete
    lastAttemptAt?
    boundedFailure?
  lastConvergence
```

Lifecycle operations must use stable operation IDs. A crash between an external
command and the following persisted stage must cause a fresh truth read and a
safe repeated command, never blind action replay.

Cross-process atomicity is neither available nor required. The design is a
durable convergence workflow: persist intent, read authoritative component
facts, issue an idempotent command, read again, and advance only when the result
is confirmed. This keeps the current local-product boundary and does not add a
cloud backend or database dependency.

## Runtime inventory contract

Runtime must stop treating its in-memory browser map as its durable session
inventory.

L1 must provide:

- `SessionStore.list()` with strict validation and deterministic ordering;
- a Runtime inventory projection for every persisted nonterminal session;
- explicit browser attachment state (`attached` or `missing`);
- recovery classification (`not_needed`, `relaunchable`,
  `cleanup_required`, or `unrecoverable`);
- the persisted session status and controller;
- workspace/profile identity and current profile-lock ownership;
- an idempotent end operation that returns already-terminal truth instead of
  failing solely because cleanup was repeated.

The existing active-session endpoint may remain for compatibility, but it must
derive from persisted inventory and cannot silently omit an open persisted
session because its browser attachment is missing.

### Restart policy

- A named workspace may be relaunched for the same persisted session only after
  exact task/session/workspace identity validation. Relaunch restores a browser
  execution surface; it never replays a browser action or Codex turn.
- A Temporary browser is not silently converted to a named workspace. If its
  process is gone and its isolated profile cannot be restored exactly, Runtime
  closes or fails the session conservatively, releases local ownership, retains
  evidence, and reports the reason.
- Conflicting profile ownership, multiple candidates, or incomplete identity
  becomes an explicit attention/error result. Rove does not guess.

## Product lifecycle projection

The host derives a lifecycle phase from the durable desired state and freshly
read component facts. The minimum phase vocabulary is:

```text
starting
ready
working
waiting_for_human
recovering
cleanup_required
closing
closed
failed
```

`closed` and `failed` require a known Runtime disposition. A completed Codex
turn may produce `ready` while its browser remains open. `cleanup_required`
means the product still owns recoverable work even if no browser is attached.

Each `ProductTaskProjection` must include:

- `lifecycle` with phase and a bounded user-facing reason;
- `availableActions`, computed by the host from authoritative facts;
- Runtime attachment/recovery summary without local paths or secrets;
- conversation summary and attention state as separate projections.

Required product actions include the applicable subset of:

```text
message
interrupt
return_control
resume
finish
retry_cleanup
archive
```

Task selection is a presentation concern. Replace `activeTaskId` as lifecycle
authority with a `currentTaskId`/selection concept. A selected older task can
still expose `finish` or `retry_cleanup` when the host says cleanup is required.
The renderer must render only host-provided actions and must not recreate the
old active-versus-history rule.

Only one new task may launch while another task has an open, recovering,
closing, or cleanup-required product lifecycle. If multiple pre-existing tasks
need reconciliation, show each explicitly and require deterministic cleanup;
do not choose by timestamp alone.

## Close and recovery workflow

Closing a task is a durable operation, not a three-call best effort. The host
must converge these postconditions in an order proven by L0:

1. Record `desiredState: closed` and the close operation before side effects.
2. Read Codex thread truth. Interrupt only an actually active turn, then confirm
   no active turn remains. Do not archive automatically unless the explicit
   product action/policy requests archival.
3. Cancel or resolve matching continuation and attention entries by exact task,
   session, request, and generation identity.
4. End Runtime idempotently and confirm terminal persisted session truth plus no
   attached browser/profile ownership.
5. Mark the close operation complete. Retain a bounded task-history projection;
   do not delete the association before the postconditions are confirmed.

On Desktop, App Server, or Runtime restart, the same workflow resumes from
freshly read facts. A failed attempt remains actionable as `cleanup_required`
with `retry_cleanup`; it must not be relabeled as read-only history.

## L0 executable contract

Before production integration, add a pure reducer/oracle that accepts:

- durable task record;
- Codex thread/turn observation, including unavailable transport;
- Runtime persisted-session and browser-attachment inventory;
- continuation and attention observations;
- the requested product operation.

It returns:

- derived lifecycle phase;
- host-allowed product actions;
- at most one next convergence command;
- the exact confirmation required before the next stage;
- a bounded error/attention result when convergence cannot continue safely.

The campaign must cover at least:

- every crash point in task bootstrap and close;
- repeated close and repeated restart recovery;
- active, completed, failed, and interrupted Codex turns;
- App Server unavailable before and after a command;
- Runtime restart with attached, missing, and conflicting browser state;
- named and Temporary browser restart behavior;
- continuation pending, dispatch-recorded, consumed, cancelled, and superseded;
- pending, resolved, stale, and reordered attention events;
- persisted task only, Runtime session only, and Codex thread only;
- mismatched task/session/thread/workspace identities;
- zero, one, and multiple cleanup-required tasks;
- bounded/deterministic output for reordered equivalent evidence.

Use table-driven and generative/model-based tests. The checked-in fixture set is
the production oracle; changing an expected transition requires Master review.

## L0 implementation evidence — 2026-09-08

Implementation status: **complete for Master review; not self-accepted**. This
gate adds no production integration and performs no external-service journey.

The executable contract is
`experiments/phase5-app-server/native-lifecycle-contract.mjs`. It exposes a pure
per-task reducer and a bounded inventory reducer. Inputs keep durable desired
state, App Server truth, Runtime persisted-session truth, browser attachment and
profile ownership, continuation state, attention state, and the requested
operation separate. Outputs contain one derived phase, phase-specific product
actions, zero or one convergence command, the exact confirmation for that
command, and a bounded attention result.

The contract uses the production continuation lifecycle directly: record status
`pending | consumed | cancelled | superseded`, continuation policy, fresh
inspection requirement, exact return event, and durable command
`dispatchStatus: not_started | possibly_started | terminal`. The additional
`resolution_unknown` observation is restricted to reconciliation and cannot
authorize another dispatch.

The checked-in production oracle is
`experiments/phase5-app-server/fixtures/native-lifecycle-l0.json`. Its 55 named
transitions cover bootstrap and close crash cuts, repeated completion,
available and unavailable component truth, all required turn outcomes, named
and Temporary recovery, continuation and attention terminality, orphaned
component combinations, and identity conflicts. Expected transition changes
remain subject to Master review.

`experiments/phase5-app-server/run-native-lifecycle-l0.mjs` adds an exhaustive
deterministic cross-product and model-based close/restart sequences. The
checked-in bounded result is
`docs/experiments/artifacts/p5.9-native-lifecycle-l0/results.json`:

- 55 table-driven transitions passed, including all three Master review rounds,
  counterexamples for late active Codex truth, late active Runtime truth,
  completed-stage contradiction, Codex attention, and exact Return Control;
- 8,640 valid exhaustive states passed deterministic replay, one-command,
  exact-confirmation, reordered-attention, operation-disposition, and
  output-bound invariants; 2,880
  contradictory Cartesian states were rejected deterministically;
- 64 model-based close/restart sequences converged in at most nine commands and
  repeated close was inert;
- 17 focused semantic cases, 26 additional bootstrap/relaunch/Temporary/close,
  Return Control, App Server recovery, and operation-retention transition
  sequences, and 20 malformed/contradictory cases passed;
- 56,223 assertions passed; the largest serialized reducer output was 773
  bytes against the 4,096-byte campaign bound;
- zero, one, and multiple cleanup-required inventory cases proved launch
  admission and stable conflict reporting without recency selection.

Commands run for this gate:

```bash
pnpm phase5:p59:l0 -- --write-evidence
pnpm phase5:p50:fixtures
pnpm exec eslint experiments/phase5-app-server/native-lifecycle-contract.mjs experiments/phase5-app-server/run-native-lifecycle-l0.mjs
pnpm exec prettier --check experiments/phase5-app-server/native-lifecycle-contract.mjs experiments/phase5-app-server/run-native-lifecycle-l0.mjs experiments/phase5-app-server/fixtures/native-lifecycle-l0.json experiments/phase5-app-server/README.md docs/experiments/2026-09-08-phase5-p59-native-lifecycle-convergence.md docs/experiments/artifacts/p5.9-native-lifecycle-l0/results.json package.json
git diff --check
```

The P5.0 oracle remained green at 75/75. L0 is a contract oracle only: Runtime,
Companion, preload/IPC, renderer, package behavior, and live recovery remain
unmodified and unqualified until L1 and L2.

### Master review correction

The first L0 submission was not accepted. The corrected reducer now treats
durable stages only as progress markers and rechecks fresh Codex,
continuation/attention, Runtime session, browser attachment, and profile
ownership truth before every later transition. A `codex_settled` record cannot
bypass a newly active turn; `runtime_settled` and `complete` cannot bypass an
active, attached, or locked Runtime; and a contradictory completed record emits
an actionable cleanup command.

Inputs and outputs now use strict keys, bounded identities/text, enumerated
domains, canonical calendar-valid timestamps, and required/forbidden field
relationships. Malformed and contradictory facts reject instead of being
silently projected. Named relaunch additionally requires the exact existing
nonterminal persisted session, matching workspace identity, missing attachment,
`relaunchable` classification, and released or claimable profile ownership.

Allowed actions are evidence-derived. Generic Codex attention exposes its own
response action and never implies Return Control. Return Control appears only
for exact active human Runtime ownership plus matching handoff, continuation,
and Rove-control attention identity, and the transition campaign proves it is
not exposed a second time after dispatch.

### Master review round-2 correction

The second L0 submission was also not accepted. The final correction aligns the
bootstrap oracle with the concrete production generators:
`task_<uuid>`, `ses_<32 lowercase hex>`, `handoff_<32 lowercase hex>`,
canonical `wrk_<uuid>`, `boot_<32 lowercase hex>`, `intent_<uuid>`, and
UUID-style App Server thread identities are validated deliberately. Runtime and
Codex IDs are absent until their receipts are bound. Bootstrap follows
`intent_persisted -> runtime_dispatching -> runtime_bound ->
thread_dispatching -> complete`, using Runtime `bootstrapId` and Codex
`threadSource` for exact zero/one/conflicting lookup recovery. No command asks
App Server to create a caller-selected thread ID.

Codex truth now includes `notLoaded | idle | active | systemError`, archived
state, thread-source lookup cardinality, and active-turn relationships. The
oracle resumes a not-loaded thread, unarchives before open-task work, recovers a
system-error state, archives only an applicable closed thread, and treats an
exact repeated archive as already complete.

Return Control is split into independently confirmed cuts: Runtime ownership
return, post-return inspection after the recorded observation sequence, durable
return-event binding, stable continuation-command preparation, durable
possibly-started dispatch intent, and dispatch/reconciliation by stable command
identity. `explicit_user_response` never auto-dispatches. Stale return events
and changed handoff generations reject.

Every requested operation now returns `accepted`,
`deferred-for-convergence`, or `rejected` with a bounded reason. Rejected
operations emit no unrelated convergence command. Deferred message operations
retain their `intent_<uuid>` identity across App Server loading and execute
only after the prerequisite is confirmed. Attention or continuation outcomes marked
unknown reconcile by exact receipt before another response, cancellation, or
continuation dispatch.

### Independent Master acceptance of L0 — 2026-09-08

L0 is **accepted** after three review rounds. The Master independently inspected
the final reducer, fixtures, transition runner, and evidence; replayed the L0
campaign; verified the P5.0 compatibility oracle; and ran the focused quality
checks.

The final accepted evidence is:

- 55 named transition fixtures;
- 8,640 valid exhaustive states and 2,880 deterministically rejected
  contradictory states;
- 64 close/restart model sequences;
- 17 focused semantic cases;
- 26 additional transition sequences;
- 20 malformed or contradictory input rejections;
- 56,223 assertions, with a maximum serialized output of 773 bytes;
- P5.0 compatibility oracle: 75/75;
- focused ESLint, Prettier, and `git diff --check`: passed.

The final review specifically confirmed that unbound Runtime bootstrap and
Codex thread-source conflicts cannot reach `closed`; launch requests carry an
explicit accepted/deferred/rejected disposition and preserve their stable
operation identity; and a fresh-inspection proof cannot claim an observation
sequence beyond current Runtime truth.

This acceptance locks the L0 fixture and reducer semantics as the L1 production
target. It does not accept any production integration, packaged recovery, or
external-service behavior.

### Master review round-3 correction

Unbound close now evaluates Runtime `bootstrapLookup` and Codex `sourceLookup`
cardinality before advancing any close stage. Zero matches may converge without
inventing an identity, one exact match is targeted through the component-returned
session or thread identity, and conflicting matches remain stable in
non-actionable `cleanup_required` state. The fixture campaign covers both
conflicting authorities; the transition campaign covers zero and exact-one
outcomes plus launch admission from each conflict.

Inventory-level launch now has the same strict, bounded operation disposition as
task operations. Zero blockers accepts and persists the exact launch intent; one
actionable blocker defers while retaining that intent ID and later persists the
same ID; a non-actionable or multiple-task conflict rejects without forwarding
an unrelated component command.

Fresh-inspection proof must now be later than the pre-handoff observation and no
later than current Runtime `observationSeq`, in addition to matching the exact
session, handoff, and generation. Future, stale, and identity-mismatched proofs
are rejected by dedicated cases.

## L1 production integration

L1 is one cohesive change set across storage, protocol, Runtime, Companion,
`LocalProductApi`, preload/IPC, and renderer. It must remove the old lifecycle
decision path rather than keeping parallel authorities.

Required removals or replacements:

- no product decision may depend on `BrowserService.sessionIds()` alone;
- no lifecycle decision may depend on `activeRuntimeTaskId()`;
- no renderer control may depend on equality with `activeTaskId`;
- no task context may be deleted before durable close convergence;
- no restart path may accept `Session.status === active` without checking the
  current browser attachment/recovery classification;
- no normal product path may create a second independently persisted lifecycle
  for the same task.

Compatibility readers may migrate P5.7/P5.9 task-context files once. Migration
must be versioned, strict, idempotent, and tested with the exact accepted fixture.
Unknown or contradictory state fails closed with a recoverable diagnostic.

## L2 local recovery qualification

L1 implementation evidence and the review handoff are recorded in
[`2026-09-08-phase5-p59-l1-production-convergence.md`](2026-09-08-phase5-p59-l1-production-convergence.md).

L2 must use real source/production-equivalent processes and an isolated Rove
home. It must not contact GitHub, Google, or another external service. Packaging
is deliberately excluded from this iterative gate.

Required local-process scenarios:

1. Named workspace task, completed Codex turn, open browser, clean Desktop
   restart: task remains finishable and the workspace is recovered without
   replay.
2. Named workspace task, Runtime killed, Desktop still open: inventory exposes
   recovery, the browser is safely relaunched or cleanup remains actionable,
   and Finish converges.
3. Temporary task with lost Runtime/browser process: the product reports the
   exact non-restorable state and completes conservative cleanup without using a
   named workspace.
4. Crash after every close stage: restart resumes and eventually reaches closed
   state; repeated Finish is safe.
5. Human-control handoff during restart: controller and pending continuation are
   restored exactly, and Return Control dispatches at most once after fresh
   inspection.
6. Multiple persisted tasks requiring cleanup: all are visible, none is chosen
   by recency alone, and no new task launches until the conflict is resolved.

Evidence must include process identities, version/digests, lifecycle records,
Runtime inventories, UI screenshots, event order, and terminal cleanup checks.
Secrets, tokens, browser profile contents, and conversation text unrelated to
the fixture must not be recorded.

## Verification baseline

Each iterative gate must run its focused campaign plus the existing P5.0
oracle, Codex integration suite, Runtime/MCP suites, full repository suite,
typecheck, lint, build, Desktop staging, Prettier, and `git diff --check`. L2
additionally runs the real local process-restart matrix. Package verification
is deferred until the local P5.9 journeys are accepted.

The implemented L2 matrix and measured evidence are recorded in
[`2026-09-08-phase5-p59-l2-production-recovery.md`](2026-09-08-phase5-p59-l2-production-recovery.md).
It passed both implementation and independent Master runs. L2 is accepted and
local external-service P5.9 execution is authorized. Packaging remains deferred
until the local live journeys pass.

P5.9 external-service acceptance may resume only after the Master accepts L0,
L1, and L2 and independently confirms no stale browser process, profile lock,
open Runtime session, or cleanup-required task remains in the qualification
home. Final Phase 5 acceptance additionally requires one packaged release gate
covering startup, authentication return, restart recovery, and terminal cleanup
on the exact distributable.

## Non-goals

- no cloud API, synchronization queue, device registration, or remote browser;
- no workflow/scheduling product;
- no broad redesign of browser perception or interaction;
- no external-service mutation during L0–L2;
- no second Companion or browser-control surface;
- no UI-only workaround for missing lifecycle truth.

## References

- [Phase 5 implementation architecture](../implementation/phase5-codex-app-server-integration.md)
- [P5.9 live acceptance plan](2026-09-08-phase5-p59-live-acceptance-plan.md)
- [Official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server?translationFallback=es-419)
