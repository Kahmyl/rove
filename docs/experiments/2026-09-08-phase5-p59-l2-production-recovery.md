# Phase 5 P5.9 L2 production recovery qualification

Date: 2026-09-08

Status: **accepted by independent Master review. External-service P5.9
execution may proceed locally. Packaging remains deferred until those journeys
pass.**

## Outcome

The source-built production path passed the eight-case L2 local recovery
matrix. The harness starts the real `DesktopHost`, managed Runtime process,
production `CodexExecutionCore`, actual Rove MCP stdio server, production
preload-shaped renderer boundary, and built React renderer. A deterministic
local JSONL App Server stand-in supplies only protocol truth; no external
service is contacted.

Run the matrix with `pnpm phase5:p59:l2`. It uses a new isolated Rove home,
exercises process and crash boundaries, captures evidence, closes every owned
resource, measures terminal state, and removes the isolated home. It does not
build a Desktop package.

## Passed scenarios

1. A named-workspace task survived a clean Desktop replacement. The original
   Desktop, Runtime, and App Server PIDs were all dead; exactly three unique
   replacement processes were live; task/session/workspace identities were
   unchanged; and neither `thread/start` nor `turn/start` replayed.
2. A managed Runtime `SIGKILL` restored exactly one attachment for the original
   task and session. Inventory cardinality was unchanged, proving no second
   session was created.
3. A lost Temporary browser projected non-restorable cleanup and converged to a
   terminal, detached, released session without substituting a named profile.
4. Crashes after `requested`, `codex_settled`, `continuation_settled`, and
   `runtime_settled` all resumed to `closed`. Each isolated home contained one
   Runtime session and one App Server thread/turn; repeated Finish was inert.
5. Human return was cut before Return Control and after return but before
   continuation reconciliation. Runtime controller, handoff identity,
   observation cursor, and continuation state survived. Fresh inspection was
   proven and exactly one continuation turn was dispatched.
6. A persisted 14-task fixture (two cleanup blockers and twelve closed
   histories) was projected through production `LocalProductApi.readSnapshot`,
   passed through the preload-shaped API, and rendered by the built product UI.
   Both blockers remained selectable, eight terminal histories remained
   visible, and both the API and UI visibly blocked new launch.
7. App Server termination projected cached task truth as unavailable/recovering.
   Reconnect performed fresh `thread/read` calls without replaying a user turn.
8. App Server-owned loopback authentication proved three distinct cases:
   process termination refused the old listener connection, a superseded login
   identity received HTTP 410 from the current listener, and a completed
   callback replay was rejected.

## Production corrections discovered by L2

- Dead predecessor processes no longer retain current profile-lock ownership.
- Terminal cleanup reconstructs a missing ownership fence for persisted active
  sessions, allowing a lost Temporary session to close conservatively.
- `getControlStatus()` returns the latest durable observation sequence, so
  post-return recovery can prove a fresh inspection across restart.
- Consumed control-handoff attention retains a valid handoff identity in
  terminal lifecycle projection.
- Terminal named-workspace cleanup removes an exact claimable dead-owner lock
  even when the new Runtime never held that lock in memory.
- The product surface displays the launch gate reason while retained cleanup
  blockers are selected.

## Evidence and cleanup

Machine-readable evidence is in
[`artifacts/p5.9-production-recovery-l2/results.json`](artifacts/p5.9-production-recovery-l2/results.json).
The renderer capture is
[`artifacts/p5.9-production-recovery-l2/retained-blockers.png`](artifacts/p5.9-production-recovery-l2/retained-blockers.png).

The passing run measured 46 owned child-process identities and 18 owned
listening endpoints after finalization. Residue was zero for live children,
listening ports, profile locks, attached browsers, nonterminal Runtime
sessions, and cleanup-required production tasks. All seven process-backed
scenario homes were observed terminal and the qualification root was confirmed
removed.

## Verification

- L2 source-built process matrix: 8/8 scenarios passed.
- L0 native lifecycle campaign: 55 fixtures, 8,640 valid states, 2,880
  deterministic rejections, 64 model sequences, 56,223 assertions.
- P5.0 compatibility campaign: 75/75 passed.
- Focused Runtime, profile-lock, continuation, LocalProductApi, and renderer
  tests passed.
- Full repository suite: 140 files, 891/891 tests passed.
- Repository lint, typecheck, source build, changed-file formatting, and
  `git diff --check` passed.

The implementation-side offline production-dependency staging check stopped
because three package tarballs were absent from the local content store. During
independent review, those dependencies were fetched and Companion, Runtime,
and MCP were staged into disposable local directories. All three built
entrypoints were present and their actual production ESM imports resolved. The
temporary staging directories were then removed. This was a dependency-layout
check only; no package was produced.

## Independent Master review

The Master reran the complete gate after the implementation task became idle:

- L2 source-built process matrix: 8/8 scenarios passed with 46 tracked child
  process identities, 18 tracked listening endpoints, and zero measured
  residue;
- L0 lifecycle campaign: 56,223 assertions passed;
- P5.0 compatibility campaign: 75/75 passed;
- full repository suite: 140 files, 891/891 tests passed;
- lint, typecheck, source build, changed-file Prettier, and
  `git diff --check`: passed;
- disposable production dependency staging and actual production ESM import
  resolution for Companion, Runtime, and MCP: passed.

Master decision: **L2 accepted.** This authorizes local P5.9 live acceptance
journeys. It does not authorize packaging before those journeys pass.

No GitHub, Google, or other external service was contacted during L2. No
Desktop package, commit, push, merge, rebase, or pull request was produced. L2
acceptance does not accept P5.9 or Phase 5 as a whole.
