# ROVE-STAB-13 — Cross-cutting interaction and accessibility qualification

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Blocked on repaired product tickets  
**Dependencies:** STAB-02 through STAB-11 as applicable  
**Planning baseline:** `f26f2f1e7ff3bf3ff4f674ebeb234daf5fedbd2d`

This ticket is part of one stabilization sprint. It is not a separate sprint or release phase. Work must stay within this ticket's invariant, receive ticket-level verification, and be checkpointed before the next ticket begins.

## Continuity entry contract

A prior ticket handoff is **continuation state, not live repository truth**. Before acting, run `pnpm codex:context`, verify the intended checkout/branch/HEAD/worktree, compare it with [continuity-ledger.md](continuity-ledger.md), and reconcile any difference. Do not ask a new agent to rediscover settled evidence unless current repository/runtime facts contradict it.

### Required inherited state

This ticket consumes the merged outputs and residual limitations of all repaired product tickets. Its purpose is composition qualification, not rediscovery or silent remediation.

Before running the matrix, build the qualification checklist from the continuity ledger's actual end states. If a new defect appears, assign a new MR ID and route it back to its owning ticket/family rather than fixing it invisibly inside STAB-13.

Inherit STAB-09's provider matrix rather than requiring every deterministic request-family fixture to be emitted by the pinned provider. Pinned `0.154.0-alpha.6.2` live evidence covers structured conversational input, file approval and generic command approval; dedicated network context and additional permission are unavailable, while MCP form/URL live evidence comes from candidate `0.155.0-alpha.9.2`. STAB-13 still owns keyboard-only and 820×700 qualification for the supported product presentations and must not reinterpret an unavailable provider family as a failed renderer path.

Inherit STAB-10's qualified browser-control authority rather than reconstructing it: requested and voluntary takeover preserve exact Task/session/page/handoff ownership; Return requires a fresh inspection and rejects stale targets; restart recovery and main/follower projections preserve the same identity. STAB-13 owns the combined development-app, narrow-layout, keyboard, reduced-motion, multi-Task and packaged/native-surface matrix, not another low-level control implementation.

Inherit STAB-11's browser resource and surface presentation rather than reopening it: identity-less Tasks can retry after selecting a later profile, deleted frozen profile identities recover through a new Task, bound sessions without confirmed attachment present bounded recovery, unmatched cleanup is device-global, and the full surface yields only after exact browser foreground plus a visible follower decision. The fixture Electron walkthrough passed its multi-Task recovery presentations, and a real macOS/Playwright Chromium harness qualified exact foreground PID, CDP window/page identity and viable transfer twice. STAB-13 retains the combined packaged matrix and live unrelated-foreground revocation; the latter remained deterministic-only because scripted application activation could not reliably displace Chromium during STAB-11.

Inherit STAB-12's completed base-profile exact-execution boundary without treating its provider-contract blocker as a dependency for unrelated composition checks. Selected `0.155.0-alpha.9.2` routes local commands only through Rove-owned `rove_exec`; exact macOS termination, receipt, restart and owner-crash behavior are qualified. Elevated permission execution remains fail-closed because `command/exec` cannot consume the exact provider-issued approval grant. This ticket may exercise supported `rove_task` journeys and all non-execution interaction/accessibility work, but must exclude elevated execution from pass claims and must not close or bypass STAB-12.

## Objective

Prove that individually repaired authorities compose into one coherent product.

## Owns

MR-016, MR-025 downstream qualification, and any integration defect discovered only when repaired features coexist.

## Qualification matrix

Exercise at minimum:

- Working + Queue + Steer;
- Needs Input on background Task;
- recovery on a different Task;
- browser attached / requested takeover / human control / return checking;
- normal completion and failure/uncertainty distinctions;
- long conversation and long queued message;
- 1180×780 and 820×700;
- keyboard-only navigation and focus visibility;
- reduced motion;
- main/follower parity;
- auto-follow/Latest and reading-position preservation;
- multiple Tasks without selection theft.

## Rule for new defects

Do not silently fix defects inside this qualification ticket. Add a new MR finding, assign it to the owning existing ticket or split a new ticket if authority is genuinely independent, then return after correction.

## Verification

Deterministic Electron projection tests plus development-app human-visible runs. Cross-process/browser claims require real Runtime/App Server paths.

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
