# ROVE-STAB-13 — Cross-cutting interaction and accessibility qualification

**Sprint:** Rove Market-Readiness Stabilization  
**Status:** Machine qualification complete; human acceptance pending

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

### Active qualification evidence — 27 September 2026

- Start state: STAB-12 checkpoint `1bc980e` on `codex/stab13-cross-cutting-qualification`; both checkpoint branches are published to `origin` and neither is merged.
- The 28-step production-projection Electron journey passes at 1180×780 and 820×700. It covers Working/Queue/Steer/Stop presentation, background attention, recovery/outcome distinctions, long content, multiple Tasks without selection theft, reduced motion, Latest/reading-position preservation and main/follower parity.
- MR-016 is now covered by a retained combined check: every supported attention family is keyboard-reachable with `:focus-visible` controls and no horizontal/document-dialog overflow at 820×700. This is renderer qualification; live family reachability remains the inherited STAB-09 provider matrix.
- MR-032 and MR-033 were recorded before correction. The manifest now derives its real Git branch, the manual Stop boundary distinguishes this fixture from process-backed base-profile proof and the open elevated blocker, and scoped approval labels/consequences retain an automated stacked-layout guard plus screenshot evidence.
- The real macOS foreground fixture qualified the exact Chromium process/page, viable full-surface-to-follower transfer, revocation when a separately launched unrelated Electron application became the actual native foreground process, and recovery when the exact owned browser returned to foreground.
- A local unsigned darwin/arm64 directory package was built and its packaged smoke test passed. The retained packaged critical-interaction harness launches that exact `.app`, opens its surface through the production single-instance path, hydrates a temporary production-format SQLite home, switches among three Tasks, renders persisted conversation, rejects a stale provider approval after restart, presents Stop only from reconciled production state, and passes keyboard-focus/overflow checks at 820×700. It does not manufacture a live provider request or task-bound browser authority, so live attention and browser/follower composition remain human-visible boundaries.

Elevated local execution remains excluded. This evidence does not close STAB-12 or establish market readiness.

## Remaining human acceptance checklist

Run this checklist from the final STAB-13 checkpoint in the development app. Use disposable Task/runtime state and only harmless work. This is a human composition gate; do not replace an observation with fixture output.

1. Open two Tasks. Start ordinary conversational work in the first, switch to the second while the first is active, then return. Expected: each transcript, status and controls remain attached to its own Task; no selection theft or cross-Task attention occurs.
2. Produce one supported Needs Input request on the background Task and navigate to it using only the keyboard at approximately 820×700. Expected: the owning Task alone advertises attention; every offered choice, refusal and scope explanation is readable, reachable and visibly focused with no horizontal overflow.
3. Run harmless base-profile work that exposes Stop, then choose Stop. Expected: the UI enters Stopping first and reports Stopped only after exact observed execution termination; interrupting a Codex turn alone never produces Stopped.
4. Attach the managed browser to one Task, exercise requested or voluntary Take Over, switch to a real unrelated local application, return to the exact owned browser, then Return to Rove. Expected: the full surface yields only when follower placement is viable, the follower disappears over the unrelated application, returns only over the owned browser, and Return enters fresh Checking before agent control resumes.
5. Repeat Task switching while the browser Task is in human control and while another Task needs input. Expected: main and follower identify the same owning Task and no current/newest UI selection changes execution or browser authority.
6. Inspect the same flow at 1180×780 and 820×700 with reduced motion enabled. Expected: no clipped request/actions, hidden Stop, unstable reading position, inaccessible Latest control, or motion-dependent state explanation.

Record the exact commit, operating-system build, provider/component version, window sizes, pass/fail for each step, and screenshots for any failure. A human pass closes only this composition gate; it does not close elevated execution or Windows/Linux packaged process-tree qualification.

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
