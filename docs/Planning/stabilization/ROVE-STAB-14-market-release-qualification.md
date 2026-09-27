# ROVE-STAB-14 — Market release qualification

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Machine qualification complete; external and human release gates open  
**Dependencies:** All nonblocked tickets; explicit disposition for STAB-12  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

This is the accumulated sprint gate. Consume every completed ticket's exit handoff, every open/new MR finding, every accepted provider limitation, the current packaged/runtime dependency baselines, and MR-029 qualification-CI nondeterminism.

STAB-12's base-profile exact-execution boundary may enter the release matrix, but elevated local execution remains an explicit provider-contract blocker. Codex owns permission profiles, review and amendments; Rove will not add a second grant authority. If the final release contract requires elevated execution, this ticket cannot declare market readiness until a supported provider seam passes the retained exact grant-consumption qualification. A release scope that omits elevated execution would require a separate explicit product decision; fail-closed implementation alone is not that decision.

Do not infer release readiness from the original sprint plan. The release matrix must be generated from the continuity ledger as it exists when STAB-14 starts.

STAB-13 enters with its machine matrix complete: the 28-step development Electron projection, seven-family 820×700 keyboard/accessibility coverage, exact macOS native browser foreground/unrelated-application revocation/recovery, unsigned package smoke, and packaged persisted-Task critical interaction all pass. The packaged harness intentionally rejects stale provider attention and does not synthesize live provider or browser authority. STAB-14 must retain those limits, consume the short STAB-13 human checklist, and keep live packaged browser/follower composition distinct from deterministic evidence.

## Objective

Qualify the repaired system as a market candidate, not merely a development build with passing unit tests.

## Required evidence

- repository checks, typecheck, lint, build and a repeatable full deterministic suite;
- qualification-CI determinism: process-backed tests used as release gates must stop failing different cases on unchanged/docs-only code; known nondeterminism is either fixed or explicitly removed from the blocking gate with a bounded replacement test;
- TaskEngine process-cut/restart and production traces;
- managed Runtime recovery/chaos matrix;
- real App Server attention family characterization;
- real managed browser Agent/Companion takeover and return;
- persistent SQLite restart/upgrade with representative existing state;
- packaged application critical-path qualification;
- responsive/accessibility Electron journey;
- final human walkthrough;
- release ledger of every remaining provider/platform qualification boundary.

## Active qualification evidence — 27 September 2026

- Exact start: published STAB-13 head `e187e91` on `codex/stab14-market-release-qualification`; no product source changed during this ticket.
- MR-029 is closed by a named `pnpm test:release` gate capped at four workers, now used by repository CI. Three consecutive unchanged-code direct runs passed 203 files / 1,737 tests in 121.61s, 120.58s and 120.89s; the named gate then passed the same 203 / 1,737 in 123.78s. No assertion or timeout changed. One nested-sandbox invocation failed uniformly with `listen EPERM` and is environmental evidence only; the permission-correct rerun passed.
- Repository checks passed 722 files / 1,318 relative imports / 113 local links. Lint, typecheck, build and all 25 experiment tests passed.
- TaskEngine and Runtime qualification passed: all 22 real process cut points and seven production composition traces passed in every full-suite run; the lifecycle oracle passed 63,417 assertions; the production-equivalent recovery harness passed Desktop, Runtime and App Server restart, temporary loss, authentication return, five close crash cuts, two human-return cuts and persistent cleanup presentation with zero stale children, ports, profile locks, browser attachments or nonterminal sessions.
- Selected `0.155.0-alpha.9.2` and rollback `0.154.0-alpha.6.2` component directories, compiled schemas, receipts, staging, rollback and tamper fixtures passed. Both exact-execution harnesses preserved the `rove_task` sandbox, terminated only the exact process tree, observed final exit, preserved the unrelated execution and suppressed the owner-crash sentinel. Both still reported provider grant consumption blocked and no elevated effect.
- The credential-free App Server attention boundary passed with an isolated unauthenticated home. Its form and URL fixture tools connected, and direct calls were correctly characterized as auto-declined without an application-client request. No live model turn, real account, approval grant, URL open or external mutation was performed; STAB-09's retained live family matrix remains the provider evidence.
- Real managed-browser requested handoff, voluntary takeover, Return and fresh inspection passed. STAB-13's exact native foreground/unrelated-application revocation/recovery, 28-screenshot responsive interaction journey, unsigned darwin/arm64 package build/smoke and packaged critical interaction harness are inherited from the exact parent head and remain green.
- Persistent SQLite upgrade/restart is covered by the repeated ledger/store/import/integrity suites, production process traces, production-equivalent recovery harness and packaged production-format hydration. No migration or persistence contract changed in STAB-14.

### Recorded acceptance run — 27 September 2026

- The complete evidence package is rooted at `artifacts/human-e2e-acceptance/20260927T144500Z/`. Its human-paced Stage 1–4 walkthrough, final composition and packaged composition are indexed by `manifest.json`, `walkthrough.md` and `SHA256SUMS`. The manifest records 44 steps: 37 passes, six unqualified steps and one blocked native-capture step. Its conclusion is `RECORDED E2E ACCEPTANCE: PARTIAL`; independent human review remains pending.
- The deterministic presentation recordings qualify readable renderer transitions, keyboard focus and responsive containment only. They do not replace live provider, process, native-browser or operating-system authority. The genuine fixture `Stopping` interval remains 80 ms and was not stretched to manufacture a human-visible pass.
- The real development application passed persisted conversation and Task switching across a stop/relaunch against the same temporary production-format home, including stale-attention rejection and reconciled Stop presentation. The real packaged `.app` passed the same persistence, switching and narrow-focus composition. Neither run exercised live provider attention or live task-bound browser/follower authority.
- macOS Screen Recording permission was denied (`CGPreflightScreenCaptureAccess() == false`), and `/usr/sbin/screencapture` produced no evidence file. Native full-desktop Stage 3 and continuous pre-renderer launch capture are therefore blocked on this host rather than inferred from the passing machine harness.
- The acceptance run introduced no product correctness or authorization finding. No new MR ID was opened. Exact integrity anchors are: manifest `346c58b25379a2ca1d57efdb70146fbe0bcd382ace7eb5dc75fdf76e682a9a31`, walkthrough `5a8708a0c853ded4146795c3c7c314c7c9dd1ffc3fa869ef51338d8127705aa9`, full walkthrough `d5cb5a10292729d377cc410344e9a20ffee1cb710753b0d705b09b005ecaa7eb`, final composition `ffdf24fc52089201a6cb3ddd848e7bf92860cd488646e2a03e542e2b80fb3d55`, and packaged composition `3655ad1be0694bb3c8a1bcc912adeb815ac7f3876d4beecd5d926be595fa71c2`.
- Fresh verification passed: `pnpm customer-journey:conversation-task` (28 screenshots), `pnpm surface:native-foreground`, `pnpm surface:packaged-critical`, `pnpm agent:command-exec-stop`, `pnpm agent:attention-boundary`, `pnpm test:recovery:processes`, `pnpm check:repository` (722 files / 1,318 imports / 113 links), and `pnpm test:release` (203 files / 1,737 tests in 122.01 seconds). Initial sandboxed Electron/loopback attempts failed on host-policy denial and passed unchanged with the necessary host permissions.

## Open release gates

| Gate                                 | Current evidence                                                                                                                                                                                                                                                    | Required authority / evidence                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider-owned elevated grant seam   | Base-profile execution and Stop are exact; selected and rollback providers ignore or cannot consume synthetic exact grant fields, and `rove_task` denies the elevated effect.                                                                                       | A supported provider contract must bind the exact authoritative connection, Task/thread/turn/request/profile/reviewer/grant/tool-call/execution identity with atomic pre-spawn validation, replay/expiry/revocation and stale/cross-authority rejection, then pass the retained human/automatic grant matrix. |
| Windows/Linux packaged process trees | macOS arm64 exact termination, unrelated-process isolation and owner-crash behavior pass.                                                                                                                                                                           | Representative Windows and Linux package/process-tree qualification with final-exit receipts and restart recovery.                                                                                                                                                                                            |
| Human development-app composition    | A human-paced automated recording now covers the presentation checklist, and a real development restart recording covers persistence. It is explicitly partial: genuine Stopping readability, continuous initial launch, native full-surface capture and independent human review remain unqualified.                      | Grant macOS Screen Recording permission, record the missing native/launch boundaries, and have a human review the exact evidence package; automation may not self-certify acceptance.                                                                                                                         |
| Packaged live authority composition  | The real `.app` passes startup, managed-service smoke, production SQLite hydration, Task switching, stale-attention rejection, reconciled Stop and narrow keyboard/overflow checks. It does not synthesize a live provider request or task-bound browser authority. | Representative packaged live provider attention and browser/follower takeover/return, plus authentication, outage recovery and OS-permission observation, without fixture authority injection.                                                                                                                |
| Distribution breadth                 | The qualified package is unsigned darwin/arm64.                                                                                                                                                                                                                     | Signing/notarization and representative native-ABI, recording/playback and supported-platform packaging evidence required by the final distribution contract.                                                                                                                                                 |

These are genuine provider, platform and human gates. The sprint and product are not market-ready while they remain open. Because elevated execution is not the only remaining gate, no release-scope product decision is requested yet.

## Release gate

No open P0/P1 correctness or authorization defect may be hidden by copy, retries or disabled controls. Any unresolved external blocker must have an explicit product/architecture disposition and must not be represented to customers as a capability Rove cannot prove.

## Sprint completion

When this ticket passes, update Implementation Status from evidence, mark the stabilization sprint complete, and retire obsolete planning instructions through normal Git history.

## Continuity exit / handoff contract

This ticket is **not complete** merely because its implementation and tests pass. Before changing its status to Complete, make the resulting engineering state durable for the next ticket.

Update [continuity-ledger.md](continuity-ledger.md) with:

- exact ticket start SHA and final ticket commit/PR/merge SHA;
- MR findings closed, narrowed, superseded, or newly discovered;
- confirmed root cause(s) and important hypotheses disproved;
- invariant actually established by the implementation;
- exact production/schema/persistence/contract files changed;
- migration, compatibility, provider-version, or fixture consequences;
- focused verification and affected-subsystem verification with exact commands/results;
- real-boundary/E2E evidence, including paths/hashes where material;
- failures, flakiness, and anything not qualified;
- preserved reproduction state and whether it remains valid;
- residual blockers/open questions;
- direct downstream tickets whose assumptions or entry contracts changed;
- the exact next stop point and next verification gate.

Then update every directly dependent ticket's **Continuity entry contract** when the new evidence changes what that ticket must inherit. The next ticket must be able to continue from repository-owned state without reconstructing this investigation from chat history.
