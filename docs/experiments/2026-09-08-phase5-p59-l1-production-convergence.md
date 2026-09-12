# Phase 5 P5.9 L1 production convergence

Date: 2026-09-08

Status: **accepted by the Master Engineering Agent; L2 has locally passed and
is submitted for independent review; packaging has not started**

## Outcome

L1 connects persisted Runtime inventory, exact browser recovery, durable task
lifecycle convergence, the trusted product API, IPC-facing renderer intents, and
renderer actions to the accepted L0 lifecycle authority.

The accepted reducer now lives behind the fully typed production-owned protocol
adapter at `packages/protocol/src/native-lifecycle-contract.ts`. Its verbatim
implementation is isolated as
`packages/protocol/src/native-lifecycle-contract.generated.ts`; only that
generated artifact suppresses inference errors. The adapter declares the full
input, durable-state, observation, operation, command, confirmation, and output
types while the generated implementation performs the accepted strict runtime
validation. The L0 experiment entry point re-exports that exact function, and a
production parity test checks compile-time input conformance, function identity,
and runtime output parity. This avoids both a second lifecycle model and a
packaged runtime dependency on `experiments/`.

## Production contracts

- Runtime inventory schema: version 1. Each persisted session reports its
  immutable browser identity, browser attachment, recovery classification,
  profile ownership, and a bounded diagnostic.
- Local product API: version 4. Task writes carry an explicit task identity and
  stable `intent_<uuid>` operation identity; task selection is represented by
  `currentTaskId` and is not lifecycle authority.
- Task lifecycle record: version 1, stored within the task-context authority.
  Close intent and progress survive restart through requested, Codex-settled,
  continuation/attention-settled, Runtime-settled, and complete stages.
- Task-context envelope: version 3. The existing v2 path is migrated once,
  strictly and atomically, then reads idempotently without another rewrite.
- Return Control persists its stable operation identity, fresh post-return
  inspection proof, return-event identity, continuation command, and
  possibly-started dispatch state as separate durable cuts.

## Convergence behavior

- Session discovery reads all persisted session records rather than deriving
  lifecycle from attached browser processes.
- Named workspaces may reattach only the exact nonterminal persisted session,
  with exact workspace identity and released/claimable profile ownership. No
  initial navigation or browser action is replayed.
- Loss of a Temporary browser is terminal and becomes actionable cleanup.
- Close records desired closed state before effects, confirms Codex has no
  active turn, settles exact continuation and attention identities, ends
  Runtime idempotently, confirms terminal/detached/released truth, then retains
  bounded closed history.
- App Server source recovery checks both archived and unarchived inventories and
  rejects multiple exact-source matches.
- A zero-record Runtime result for a task with a bound session is not cleanup
  proof. It records `cleanup_required`, retains `retry_cleanup`, and cannot
  advance the close operation to complete.
- Unknown or contradictory lifecycle evidence is isolated to its task and
  projected as a bounded, recoverable cleanup diagnostic.
- Startup recovery resumes durable close operations before considering open-task
  recovery. Open named sessions reattach exactly; not-loaded/archived App Server
  threads recover without replaying a user turn.

## Product and renderer behavior

The host computes each task phase and allowed actions through the accepted
production reducer. The renderer displays those actions for the selected task,
including older cleanup-required tasks, and does not reconstruct an
active-versus-history lifecycle rule. Finish retries reuse the persisted close
operation identity. Return Control, message, restore, archive, and finish
intents are explicitly task-bound and validated at the host boundary.

Only closed or failed inventories admit a new launch. Multiple existing blockers
remain visible and are never selected by timestamp as lifecycle authority. The
renderer retains every nonterminal blocker in its selector while separately
capping terminal history at eight entries. If the current task becomes
terminal, the host advances selection to a remaining blocker, and the composer
states that launch is blocked until convergence.

## Master-review dispositions

1. **Production dependency on experiment path — resolved.** The implementation
   moved into `@rove/protocol`; the experiment module is only a compatibility
   re-export. Protocol and Companion production builds pass, and the L0 campaign
   executes through the same implementation.
2. **Zero Runtime inventory for a bound task — resolved fail closed.** Close
   rejects the missing confirmation, records `cleanup_required`, preserves the
   durable close stage, and exposes `retry_cleanup`. A focused test asserts the
   task is not projected closed.
3. **Hidden blocker beyond renderer history cap — resolved.** The LocalProductApi
   retains every bounded task projection, advances a terminal current selection
   to a nonterminal blocker, and rejects launch while any blocker remains. The
   renderer independently caps only terminal history. Host and renderer tests
   place a cleanup-required task behind more than eight closed histories and
   prove that it remains selectable, actionable, and launch-blocking.
4. **Profile-lock release retry — resolved.** A failed unlink leaves both the
   lock object and Runtime's session-to-lock entry retry-eligible. Deterministic
   unit and Runtime tests inject one release failure, retry the same terminal
   session, and confirm terminal, detached, released inventory truth.
5. **App Server availability truth — resolved.** Lifecycle projection now reads
   live host readiness separately from cached conversation content. A
   disconnect projects the task as recovering even with a cached association;
   reconnect recovery performs fresh `thread/read` calls and does not issue
   `thread/resume`, `turn/start`, or `turn/steer`.

## Verification evidence

Commands executed from the repository root:

```text
pnpm phase5:p59:l0
pnpm phase5:p50:fixtures
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm exec prettier --check <L1 changed files>
git diff --check
```

Results:

- accepted P5.9 L0 campaign: 55 fixtures, 8,640 valid exhaustive states,
  2,880 deterministic rejections, 64 model sequences, and 56,223 assertions;
- P5.0 compatibility fixtures: 75/75 passed;
- correction-focused blocker, profile-lock, Runtime-release, and App Server
  availability set: 39/39 passed;
- repository test suite: 140 files, 887/887 tests passed;
- repository TypeScript type-check: passed;
- repository ESLint: passed;
- all workspace production builds: passed;
- changed-file Prettier and `git diff --check`: passed.

## L1 files

Production authority and protocol:

- `packages/protocol/src/native-lifecycle-contract.ts`
- `packages/protocol/src/native-lifecycle-contract.generated.ts`
- `packages/protocol/src/index.ts`
- `packages/protocol/src/runtime.ts`
- `packages/protocol/src/schemas.ts`
- `packages/protocol/src/types.ts`
- `packages/storage/src/interfaces.ts`
- `packages/storage/src/filesystem.ts`
- `packages/browser/src/profiles/profile-lock.ts`
- `packages/browser/src/profiles/profile-lock.test.ts`

Runtime:

- `apps/runtime/src/api/session.controller.ts`
- `apps/runtime/src/runtime.service.ts`
- `apps/runtime/src/control/ownership-transition.service.ts`
- `apps/runtime/src/session/session.service.ts`
- `apps/runtime/src/runtime.integration.test.ts`
- `apps/runtime/src/session/session.bootstrap.test.ts`
- `apps/runtime/src/control/control-wait.service.test.ts`

Companion and product surface:

- `apps/companion/src/main/runtime-client.ts`
- `apps/companion/src/main/runtime-client.test.ts`
- `apps/companion/src/main/codex/lifecycle-contract.ts`
- `apps/companion/src/main/codex/task-coordinator.ts`
- `apps/companion/src/main/codex/continuations.ts`
- `apps/companion/src/main/codex/persistence.ts`
- `apps/companion/src/main/codex/execution-core.ts`
- `apps/companion/src/main/codex/local-product-api.ts`
- `apps/companion/src/main/codex/local-product-api.test.ts`
- `apps/companion/src/main/codex/phase5-execution.test.ts`
- `apps/companion/src/main/codex/product-recovery.test.ts`
- `apps/companion/src/main/codex/continuation-observation-replay.test.ts`
- `apps/companion/src/main/codex/execution-core-startup-recovery.test.ts`
- `apps/companion/src/main/codex/request-human-composition.test.ts`
- `apps/companion/src/renderer/product-surface.tsx`
- `apps/companion/src/renderer/product-surface-state.ts`
- `apps/companion/src/renderer/product-surface.test.tsx`
- `apps/companion/src/renderer/product-surface-state.test.ts`

Oracle parity:

- `experiments/phase5-app-server/native-lifecycle-contract.mjs`
- `packages/protocol/test/native-lifecycle-production.test.ts`

## Deferred qualification

L2 production-equivalent process qualification is recorded in
[`2026-09-08-phase5-p59-l2-production-recovery.md`](2026-09-08-phase5-p59-l2-production-recovery.md).
It has locally passed and awaits independent Master acceptance. Packaged-path
confirmation remains deferred. No external service was contacted and no
package was produced by L1 or L2.

## Independent Master acceptance — 2026-09-08

The Master review rejected the first L1 handoff for three customer-visible or
recovery-critical gaps: an older task could be hidden while still blocking new
work, profile-lock release could lose its retry path after a filesystem error,
and cached conversation state could be presented as if App Server were
available. The correction set makes every nonterminal task selectable, advances
the default selection away from a newly terminal task, blocks the composer with
an explicit reason, preserves lock-release retry state, and feeds live App
Server readiness into lifecycle projection. Focused regression tests cover all
three paths.

The independent review then reran:

- the accepted L0 campaign: 55 fixtures, 8,640 valid states, 2,880 deterministic
  rejections, 64 model sequences, and 56,223 assertions;
- the affected Runtime, product API, recovery, and renderer suites: 118/118;
- the full repository suite: 140 files, 887/887 tests;
- the P5.0 compatibility campaign: 75/75;
- repository typecheck, lint, all production builds, changed-file Prettier, and
  `git diff --check`.

The first sandboxed focused run was unable to open loopback fixtures or launch
Chromium. The identical host-authorized run passed; this was an execution
environment restriction, not a product result. No package was produced. L1 is
accepted; the separately implemented L2 gate has since passed locally and
awaits independent Master review.
