# Phase 5 P5.8 local product seam decision

Date: 2026-09-08

Status: **P5.8 accepted and closed by the Master Engineering Agent. P5.9 may
begin.**

## Decision

Rove Desktop is the complete Phase 5 product and device execution plane. It
does not require a cloud backend or another localhost HTTP service. The
renderer continues to use typed Desktop IPC, while `LocalProductApi` remains
the logical boundary between the product surface and local execution.

P5.8 is intentionally a compatibility-seam gate, not a cloud implementation.
The existing `LOCAL_PRODUCT_API_VERSION` remains the shared version marker. A
focused production test now proves that a representative renderer command and
a complete projected product snapshot survive JSON encode/decode without
changing values, and that the decoded command still passes the production
renderer-intent validator.

## Explicitly deferred

The following are not required by the current local product and were not
implemented:

- device registration;
- cloud account authentication;
- synchronization queues or a cloud database;
- offline cloud coordination;
- remote command/event transport;
- remote task execution or outcome authority;
- selection of Vercel or any other hosting provider.

These capabilities require concrete future Hub requirements such as
cross-device synchronization, remote task initiation, team sharing,
cloud-delivered notifications, centralized account management, or schedules
that must operate while the user's computer is offline. They will be designed
as one cohesive future phase if and when those requirements become product
commitments.

The experimental cloud-boundary fixture remains a future-design constraint,
not a production service contract. Device-local Codex state, browser identity,
local files, user decisions, action records, and verified local outcomes remain
outside any future cloud projection.

## Verification

- Focused `LocalProductApi` production test, including the new JSON round-trip
  check: **19/19 passed**.
- Full repository suite with one worker and file parallelism disabled: **139
  files, 865/865 tests passed**.
- Companion typecheck: passed.
- Repository lint and production build: passed.
- Changed-file Prettier and `git diff --check`: passed.

## P5.9 entry

P5.9 starts from the accepted local product. It must validate the native Rove
surface itself rather than an external Codex prompt that names Rove or MCP. An
uncoached user supplies a desired outcome, selects execution mode and browser
identity in Rove, and observes model/account/usage, progress, browser evidence,
attention, and recovery through the unified surface.

The live matrix includes:

1. a fresh end-to-end browser task with a verified consequential result;
2. model and reasoning-effort selection plus truthful usage availability;
3. Agent, Companion, and Capture launch semantics;
4. named-workspace continuity and explicit Temporary-browser behavior;
5. a timed-out human handoff followed by Return Control and exactly one
   continuation after fresh inspection;
6. Desktop/App Server/Runtime restart and truth-based task resume;
7. external MCP compatibility and non-regression journeys for GitHub,
   Gmail/Calendar, Drive, Maps, and multi-tab PDF/download behavior;
8. final screenshots, URLs or artifact identities, observations, receipts, and
   exact failure reporting.

Interactive login, token refresh/logout, and real approval exercises use a
disposable qualification account where mutation could disturb the user's
primary account. A missing authenticated session is reported as an environment
blocker; it is not worked around by weakening the acceptance criteria.
