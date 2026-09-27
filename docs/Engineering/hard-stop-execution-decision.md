# Hard Stop Execution Decision

**Status:** Explicit product and architecture authority required. Current provider behavior does not satisfy Rove's Hard Stop contract.

## Decision required

Choose how Rove will truthfully handle a customer request to stop current local work:

1. own exact local execution cancellation and termination evidence;
2. weaken and rename the customer operation so it promises only provider-turn interruption; or
3. retain Hard Stop as a release blocker until the selected provider exposes exact turn-owned process cancellation.

This decision is intentionally not inferred from implementation convenience. The current contract says Rove may report **Stopped** only after the exact owned local operation can no longer continue normal execution. Changing that promise is a product decision; introducing a Rove-owned executor is an architecture and security decision.

## Evidence

The selected Codex App Server `0.154.0-alpha.6.2` and candidate `0.155.0-alpha.9.2` both accept exact `turn/interrupt` and report the bound turn `interrupted` while the turn's local command continues to its original completion sentinel. Candidate `0.155.0-alpha.9.2` was qualified in both default and supported `--disable unified_exec` modes on 27 September 2026. Each live run recorded the exact executable digest, thread ID, turn ID, provider process metadata, interrupt acknowledgement, terminal state, and a sentinel written only after the original eight-second command delay. The candidate executable SHA-256 was `9280c0754e8f1f6b72f495d30c8c82a006dbc4995bf0492916fa0901f6bfd1f9`.

Upstream issue [openai/codex#42717](https://github.com/openai/codex/issues/42717) remains open. Current upstream protocol describes ordinary turn interrupt as aborting the task without terminating background terminal processes. Its thread-wide background-terminal cleanup is not exact turn/process authority and could affect unrelated work.

## Options

| Option                                  | Product result                                                                                        | Engineering consequence                                                                                                                                                                                                                                                                                                                          | Principal risk                                                                                                                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rove-owned exact execution cancellation | Retains the current **Stop** promise.                                                                 | Introduce a bounded local execution owner that records Task/turn/operation/process ancestry, terminates the exact process tree, proves quiescence, fences late output, and recovers termination state across Desktop/App Server restart. Codex must dispatch eligible local commands through that owner rather than an unowned provider process. | This is a new security- and lifecycle-critical execution boundary. Cross-platform process trees, sandboxing, approvals, terminal sessions, restart, packaging and orphan cleanup require design and qualification. |
| Weaker provider-turn interruption       | Ships a narrower operation such as **Stop responding** that does not claim the local command stopped. | Revise Product and application contracts, customer state, recovery, warnings and acceptance language so background work remains explicit and separately manageable. Never project authoritative **Stopped** from `turn/interrupt`.                                                                                                               | Customers may reasonably expect Stop to stop local effects. Continued commands can consume resources, write files or hold locks after the UI operation succeeds.                                                   |
| Retain the release blocker              | Preserves the current promise without adding a new executor yet.                                      | Keep the existing interrupt adapter for internal reconciliation, but do not market or qualify Hard Stop. Re-run the exact live harness for a newly promising pinned provider.                                                                                                                                                                    | Market readiness remains blocked and provider timing is outside Rove's control.                                                                                                                                    |

Rove-owned exact cancellation is the only option that preserves the current Hard Stop contract independently of provider behavior. That technical assessment is not authorization to build a second broad execution framework: the boundary must remain narrowly scoped to exact local commands and reuse existing Task, approval, sandbox and operation identities.

## Non-options

- Do not treat `turn/interrupt`, an `interrupted` turn state, missing UI activity, or discarded late output as process-termination evidence.
- Do not infer an OS PID from opaque provider `processId` metadata.
- Do not use `pkill`, process-name matching, guessed descendants, or thread-wide terminal cleanup as exact Task authority.
- Do not settle **Stopped** optimistically and repair it after a late sentinel.
- Do not merge the preserved Stop investigation merely to make deterministic presentation tests pass; presentation is already separate from termination authority.

## Required qualification after a decision

If exact cancellation is authorized, prove one request and one termination receipt for the exact Task/turn/operation; exact process-tree quiescence; no late sentinel/output/effect; durable recovery after dispatch and before receipt persistence; retained queue; ordinary follow-up as new work; unrelated Task/process survival; and representative macOS, Windows and Linux packaged behavior.

If weaker semantics are authorized, update the Product Brief/Direction or owning Product contract first, then update application contracts, source, UI, tests and market language together. The customer must be told that local work may continue and given a safe exact cleanup path where one exists.
