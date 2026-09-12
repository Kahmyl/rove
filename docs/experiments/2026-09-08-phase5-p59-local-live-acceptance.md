# Phase 5 P5.9 local Gate 1 correction

Date: 2026-09-08

Status: **local download/correlation, bounded target-name grounding,
failure-interpretation, and requested-handoff continuity corrections verified.
Master independently accepted the successful IRS/PDF journey. The
Gmail/Calendar journey stopped first at authentication and, after user login,
at a stale-observation tool rejection; no Calendar mutation occurred. The
preserved handoff defect was corrected and a fresh source-built local lifecycle
completed through human takeover, Return Control, one continuation, fresh
inspection, normal finish, archive, and process cleanup.**

## Outcome

The Desktop now resolves one canonical product home from Electron's stable
per-user application-data base plus `Rove/product`. This default is independent
of source versus packaged launch, repository cwd, generic `ROVE_HOME`, and
Electron's mutable `--user-data-dir`. The Desktop-only qualification override
is `ROVE_DESKTOP_HOME`; it must be absolute. No historical state was migrated.

Rove's App Server remains intentionally isolated under the canonical product
home. It does not copy, import, inspect, or reuse an ordinary Codex
installation's credentials. The visible account wording now says **Rove
account**, **Rove's Codex account**, and **Sign in to Rove with ChatGPT**.
Official App Server `account/read` state remains authoritative.

The full surface also detects a nonterminal Runtime session that has no exact
`roveSessionId` match in product task truth. It presents the session's
mode/status/controller, blocks new launch, and offers a normal **Finish
session** action. The renderer sends the exact session ID through the typed
preload IPC; the main process rechecks that the same session is still unmatched
and then calls the existing Runtime end operation. It never invents a task
binding or performs automatic cleanup. Chip and expanded surfaces expose the
same cleanup state, with expanded mode offering the same Finish action.

## Local Gate 1 rerun

The source-built native surface launched in `canonical_os_home` mode with its
managed Runtime, MCP boundary, and reviewed Codex 0.153.4 App Server. The
authoritative snapshot contained:

- no Runtime session;
- no product task, attention request, recovery warning, or product error;
- no named browser workspace and no selected workspace;
- explicit Temporary identity available and signed out;
- all three execution modes and the current model/effort catalog;
- App Server account `logged_out` with `requiresOpenaiAuth: true`;
- unavailable rate-limit and token-usage projections;
- visible browser and device-code sign-in actions; and
- disabled task launch with `Sign in to Rove with ChatGPT before starting.`

The lifecycle is therefore clean. Per the assignment, the run stopped without
starting login, a task, a browser session, or any external mutation. The
earlier cwd-relative active session was not migrated, opened, finished, or
altered.

The native screenshot is
[`artifacts/p5.9-live-acceptance/gate1-canonical-home-clean-logged-out.png`](artifacts/p5.9-live-acceptance/gate1-canonical-home-clean-logged-out.png)
(SHA-256
`0e19cc61eb5dd2ac2bbfd0ee39e740e06ebbd5e7010c5875d7536e4bd0325080`).
It is native product-surface evidence, not browser-journey evidence.

## Verification

- Focused resolver, unmatched-session, Runtime client, preload, state, and
  renderer tests: 6 files, 32/32 tests passed.
- P5.9 L2 recovery qualification: 8/8 scenarios passed.
- P5.9 L0 lifecycle oracle: 56,223 assertions passed.
- P5.0 deterministic oracle: 75/75 passed.
- Full repository suite: 142 files, 901/901 tests passed.
- Repository typecheck, lint, source build, changed-file Prettier check, and
  `git diff --check` passed.
- No package, installer, staging, external-service journey, commit, or Git
  publication command was run.

The first unprivileged L2 attempt failed before scenario execution because the
sandbox denied an isolated loopback listener with `EPERM`. The same L2 command
was rerun with local-loopback permission and passed 8/8; this was not a product
failure.

## Cleanup

Harness-owned Desktop PID 49363 and Runtime PID 49403 were verified absent
after normal close. The isolated OS-level Electron user-data directory was
removed. The canonical product home and historical homes remain in place. No
browser profile or credential content was inspected, copied, serialized, or
removed.

Machine-readable evidence is in
[`artifacts/p5.9-live-acceptance/results.json`](artifacts/p5.9-live-acceptance/results.json).

## Login completion identity correction

The Master reproduced `Stale or unknown Codex login URL` when a late completion
from one login attempt cleared a newer active login. The account catalog now
revalidates `account/login/completed` with the pinned generated notification
schema and compares its nullable `loginId` to the exact current login ID. Null,
foreign, and older completions may refresh account truth but cannot clear or
relabel a newer browser or device-code login.

A matching completion clears only its login. Matching failure projects the
fixed bounded message `Rove sign-in did not complete. Try again or use device
code.` through account state; raw App Server text, URLs, callback contents,
tokens, and account identifiers are never projected. Cancel now rechecks both
operation generation and exact login ID after the App Server response, so an
in-flight cancel for attempt A cannot remove attempt B. The renderer clears its
local fallback when authoritative success or failure arrives and visibly shows
the safe failure message.

The first focused run covered seven account/protocol/product/renderer files and
passed 83/83 tests. The built login-only renderer harness passed its exact
sequence: one login start, one automatic trusted open for that current ID, no
automatic retry, one explicit retry, exact-ID cancel, and the separate
device-code start/open.

Master re-review then found that refresh and account mutation operations still
shared one generation. An old completion or account/rate-limit notification
could therefore start a refresh while login B's start request was unresolved
and incorrectly supersede B. The catalog now maintains independent
latest-wins refresh and mutation generations. Notification refreshes no longer
fence an in-flight login; a newer login still fences an older cancel; and
logout advances both generations before and after its RPC so stale pre-logout
login, cancel, and refresh results cannot restore state. This preserves the
official response-before-notification path without weakening exact-ID
completion matching.

Deferred-promise coverage now exercises old A completion during unresolved B,
account and rate-limit notifications during unresolved B, stale refresh after
logout, and older cancel versus newer login. The updated seven-file focused
suite passed 86/86 tests. Typecheck, lint, source build, changed-file Prettier,
and whitespace diff checks passed. Per Master direction, the live login proof,
login-only renderer harness, full suite, L0, and L2 were not rerun for this
re-review correction.

### Native current-ID proof

The source-built canonical-home surface started clean and the semantic **Sign
in in browser** action was invoked once. Rove retained stable **Continue
sign-in** and **Cancel sign-in** controls after the trusted open returned; the
stale-login error did not recur.

The hosted flow then completed automatically using the browser's already
authorized ChatGPT session before the queued semantic Cancel action could find
the control. Authoritative Rove state became `logged_in`, auth mode `chatgpt`,
plan `plus`, with zero product tasks and no Runtime session. This automatic
completion was not driven or confirmed by the harness. Cancel was not retried,
and the account was not logged out or otherwise altered.

The final native product screenshot is
[`artifacts/p5.9-live-acceptance/gate1-login-current-id-auto-completed.png`](artifacts/p5.9-live-acceptance/gate1-login-current-id-auto-completed.png)
(SHA-256
`6ceeade1a17deecd1979c7a11cd39b5d728ddf512ca7c893ee0715e4edac14f5`).
It contains no account identifier and is not browser-journey evidence.
Harness-owned Desktop PID 84002 and Runtime PID 84026 were verified absent
after close.

## External campaign: Gate A stop

After Master accepted canonical-home Gate 1, the source-built native surface
created and selected one new persistent Chrome workspace:
`wrk_0d22b405-5c2a-431e-929e-29b8822e2e35`, displayed as
`Rove Live Acceptance 20260908-1619`. The timestamp-unique private repository
name `rove-phase5-live-20260908-1619-ng` was reserved before task submission.

The GitHub Agent-mode task was launched once from the native product surface as
task `task_de7d9177-ebee-4495-9b18-73b9615fa6ce`, Codex thread
`01a0819a-dfa5-78e0-b725-371572a99787`, turn
`01a0819a-eb7b-7fa2-9d33-29f824eb3d18`, and Runtime session
`ses_ca89611199014b75a3ab9cee4fa7be3b`. Startup immediately entered
`cleanup_required` with the exact reason
`Lifecycle truth was rejected: thread id is invalid.` The surface also exposed
a pending Codex elicitation for `rove/session.start`. No external page was
navigated, no repository or issue was created, no external mutation occurred,
and no Rove browser evidence was recorded.

The campaign stop rule was applied at Gate A. The native **Pause** control
changed the Runtime session to paused with no controller, and the pending
session-start elicitation was declined so the turn completed without browser
work. The two recorded observations are
`obs_da08aafca170471e9ec8db066b683136` (`session_started`) and
`obs_6dc0c7fe0943440cb3c3bbb470b842d5` (`session_paused`). The native surface
presented two identically named **Retry cleanup** controls; the semantic harness
rejected the ambiguous target, and no coordinate or non-Rove workaround was
used. Cleanup therefore remains required in canonical product truth, with the
session persisted as paused. The harness then closed normally; Desktop PID
88125 and Runtime PID 88151 were verified absent, and the transient browser-host
marker was absent.

The stop screenshot is
[`artifacts/p5.9-live-acceptance/gate-a-github-stop-thread-id-invalid.png`](artifacts/p5.9-live-acceptance/gate-a-github-stop-thread-id-invalid.png)
(SHA-256
`725ad3b430914714c29f71b25ed3e7ebaa300ad8cbbcc89d9b86cf606aec393a`).
It shows the exact lifecycle rejection, pending session-start elicitation,
zero evidence, and both cleanup controls. It is native product-surface evidence,
not an external-site screenshot.

Gmail/Calendar, Drive, Maps, public research/PDF, and the combined journey were
not started. No live-login action, Computer Use/CUA, direct task-browser
automation, site API, connector, shell HTTP, external search, package command,
commit, or Git publication occurred. P5.9 and Phase 5 remain open; this run does
not self-accept either gate.

## Gate A identity and cleanup correction

Master traced the rejection to the lifecycle authority's version-1-through-5
UUID pattern for App Server thread IDs. The pinned 0.153.4 schemas define
Codex-owned thread, turn, item, and request identities as strings, while the
observed production identifiers are opaque UUIDv7-style strings. The lifecycle
authority now validates Codex-owned identities as exact non-empty opaque strings
bounded to 256 characters. Empty, oversized, and wrongly typed values still
fail closed. Rove-owned task, Runtime session, workspace, bootstrap, handoff,
and operation identities retain their existing strict patterns and equality,
association, and duplicate checks.

The coordinator no longer hashes or rewrites Codex thread IDs, no longer maps
active Codex turn IDs through the bootstrap-ID compatibility path, and no
longer hashes Codex attention request IDs. Persisted conversation, attention,
and continuation validators use the same bounded opaque Codex identity rule.
Compatibility normalization remains only for historical Rove-owned identities.
The reviewed executable authority remains
`packages/protocol/src/native-lifecycle-contract.generated.ts`; the experimental
entry point directly re-exports it, and the production parity test asserts
function identity and equal output so the two paths cannot drift.

The full surface now has one authoritative task cleanup action in the main task
workspace. The duplicate sidebar **Retry cleanup**/**Stop** placement was
removed. Renderer coverage proves that a cleanup-required task produces exactly
one `Retry cleanup` button.

Verification after the correction:

- seven focused lifecycle/coordinator/state/continuation/renderer files passed
  77/77 tests;
- the P5.9 L0 oracle passed 56,231 assertions, including 28 rejection cases,
  with the current UUIDv7-style thread and turn identities in the checked-in
  campaign;
- the production adapter and experimental oracle remained the identical
  function;
- the P5.0 compatibility fixture campaign passed 75/75;
- the source-built P5.9 L2 recovery qualification passed all 8 scenarios with
  zero stale child processes, ports, profile locks, attached browsers,
  nonterminal Runtime sessions, or cleanup-required product tasks at terminal
  cleanup; and
- typecheck, lint, source build, changed-file Prettier, and whitespace diff
  checks passed.

### Canonical-home cleanup proof

The corrected source-built Desktop restarted against the canonical product home
without starting a new task. The previously rejected task projected
`Lifecycle is ready.` with its exact Codex thread and turn IDs unchanged, the
persisted Runtime session paused, and exactly one visible **Finish** action.
Invoking that normal product action converged the task to `closed` under
operation `intent_d2bd475a-6e06-4c6f-a9b7-6ff82eef2ad7`.

Fresh product truth then showed no companion session, no recovery warning, no
product error, and no **New task blocked** warning. The retained task history
reported Runtime status `completed`, controller `null`, attachment `missing`,
profile ownership `released`, and only the terminal **Archive** action. The
persisted Runtime record independently reported `completed`, controller `null`,
and `endedAt: 2026-09-08T15:43:43.283Z`. This establishes that new-task
admission is no longer blocked without launching a new GitHub task.

The terminal screenshot is
[`artifacts/p5.9-live-acceptance/gate-a-correction-cleanup-closed.png`](artifacts/p5.9-live-acceptance/gate-a-correction-cleanup-closed.png)
(SHA-256
`aa3979f70d42193ca073e7f3fe1adedceeb657fb6e587df0842c8bd5f14e00b4`).
Desktop PID 98438 and Runtime PID 98467 were verified absent after normal close.

Remaining uncertainty is confined to the stopped external campaign: no GitHub,
Gmail/Calendar, Drive, Maps, research/PDF, or combined outcome has been accepted,
and the Runtime's Chrome sandbox self-inspection remains `unknown` because
`chrome://sandbox` was not inspectable. No package, external journey, direct
persisted-state edit, Runtime HTTP call, coordinate interaction, DevTools, or
external browser automation was used for this correction. It is returned for
Master review and is not self-accepted.

## Master-accepted correction: Gate A retry stop

After Master accepted the identity and unique-cleanup correction, the
source-built Desktop restarted against the canonical product home for Gate A
only. The account remained `chatgpt`/`plus`, and persistent workspace
`wrk_0d22b405-5c2a-431e-929e-29b8822e2e35` (`Rove Live Acceptance
20260908-1619`) remained selected. The new timestamp-unique repository name
`rove-phase5-live-20260908-1651-ng` was reserved before any task submission.

The terminal prior task was still the product's `currentTaskId`. Its single
normal **Archive** action was invoked and fresh truth confirmed its Codex
conversation became archived, while its lifecycle stayed `closed`, its Runtime
remained completed/released, and it had no available actions. However,
`currentTaskId` remained `task_de7d9177-ebee-4495-9b18-73b9615fa6ce` after
archival. The full native surface continued to render only that archived task
history and exposed no New Task composer, no outcome field, and no navigation
control for leaving task history.

The Gate A stop rule was therefore applied before task submission. No new
Agent task, Codex thread/turn, Runtime session, browser navigation, GitHub
repository, issue, observation, evidence item, screenshot through the task
browser, or external mutation was created. No renderer manipulation, internal
product API, state edit, coordinate action, DevTools, direct task-browser
automation, site API, shell HTTP, connector, or external search was used to
bypass the missing native action.

The blocked-state screenshot is
[`artifacts/p5.9-live-acceptance/gate-a-retry-stop-no-new-task-composer.png`](artifacts/p5.9-live-acceptance/gate-a-retry-stop-no-new-task-composer.png)
(SHA-256
`8e825be599f2ef74e469c7b7b1aaea6592fb3ebd0f116c812cf5d419616bc8fc`).
It shows the closed archived history, signed-in account, selected workspace,
zero observations/evidence, and absence of any New Task composer. Desktop PID
1723 and Runtime PID 1748 were verified absent after normal close.

Gates B-F were not started. No package, publication, commit, or staging action
occurred. Gate A remains blocked pending a normal product-surface way to leave
terminal history and create a new task. This run is returned for Master review
and is not self-accepted.

## Terminal-history navigation correction

The bounded local correction redefined `LocalProductSnapshot.currentTaskId` as
the current nonterminal task only. `LocalProductApi.readSnapshot()` now retains
closed and failed tasks in bounded history but omits `currentTaskId` when no
nonterminal blocker exists. The renderer independently reconciles its local
historical selection whenever the host's active task changes or the selected
history disappears. This returns to the composer after terminal convergence
without mutating, deleting, or automatically archiving persisted task truth.

Terminal history remains selectable. Its detail view now exposes exactly one
normal semantic **Back to new task** action when no active task exists, or
**Back to active task** when a blocker exists. The action clears only the
renderer's historical selection. Host-authoritative launch gating still scans
every projected nonterminal task, so inspecting history cannot hide or bypass a
cleanup or active-task blocker.

Focused LocalProductApi, renderer-state, and ProductSurface coverage passed
40/40 tests. The P5.9 L0 oracle passed 56,231 assertions with 28 rejection
cases, the P5.0 compatibility campaign passed 75/75 fixtures, and P5.9 L2
passed all eight production-equivalent recovery scenarios with zero stale child
processes, ports, profile locks, attached browsers, nonterminal Runtime
sessions, or cleanup-required product tasks at terminal cleanup. Repository
typecheck, lint, source build, changed-file Prettier, and whitespace checks also
passed. The first sandboxed L2 attempt could not bind a loopback port
(`EPERM`); the same required local command passed after loopback/process launch
permission was granted.

### Canonical-home round-trip proof

The corrected source-built Desktop restarted against the canonical product
home with account state `logged_in`/`chatgpt`/`plus` and persistent workspace
`wrk_0d22b405-5c2a-431e-929e-29b8822e2e35` (`Rove Live Acceptance
20260908-1619`) selected. Fresh product truth retained the archived closed task
in history, omitted `currentTaskId`, reported no companion session or product
error, and rendered the empty **Desired outcome** composer with **Start task**
disabled.

Selecting the retained terminal history rendered exactly one **Back to new
task** button. Invoking it returned to the same empty composer while product
truth remained unchanged: one closed archived task, no `currentTaskId`, no new
task, no new Codex thread or turn, and no Runtime session. The terminal-history
screenshot is
[`artifacts/p5.9-live-acceptance/gate-a-navigation-terminal-history.png`](artifacts/p5.9-live-acceptance/gate-a-navigation-terminal-history.png)
(SHA-256
`2417bf12e28ab035dde1f619d5825caa7157169e31bce77a85e410fa144c947f`).
The returned-composer screenshot is
[`artifacts/p5.9-live-acceptance/gate-a-navigation-correction-composer.png`](artifacts/p5.9-live-acceptance/gate-a-navigation-correction-composer.png)
(SHA-256
`4c8a58552a2d0edfb90cf4539361b7f8e7bb0fa6ea20845acf40f6456bab1321`).
Desktop PID 7759 and Runtime PID 7784 were verified absent after normal close.

No outcome was entered or submitted, and no product task, Runtime session,
external navigation, external mutation, package, publication, commit, or
staging action occurred. Gate A and Gates B-F were not rerun. This correction
is returned for Master review and is not self-accepted.

## Master-accepted navigation correction: Gate A retry stop

After Master accepted the terminal-history navigation correction, the
source-built Desktop restarted against the canonical product home for Gate A
only. The existing `chatgpt`/`plus` account and persistent workspace
`wrk_0d22b405-5c2a-431e-929e-29b8822e2e35` (`Rove Live Acceptance
20260908-1619`) were selected. The restored normal composer submitted exactly
one Agent task using the fresh reserved repository name
`rove-phase5-live-20260908-1711-ng`. The submitted text was ordinary
outcome-only prose and named no product mechanism, connector, plugin, testing
surface, harness, or implementation detail.

The new task projected exact identities:

- product task `task_20fd610b-2511-4a56-93fd-1b8563f72b37`;
- Codex thread `01a081cb-4b87-7e00-aaae-3293607a46ed`;
- Codex turn `01a081cb-5a06-7bf1-a425-7e987879a403`;
- Runtime session `ses_fa88668ee55942ec998c0648f4eba9b7`; and
- session-start request
  `codex_38f00bfae4d449bfbd57da166e794ad1:server:0`, generation 1.

The expected session-start elicitation was accepted once through the normal
native **Approve / Send** control. Fresh product truth preserved all request,
task, thread, and turn identities and changed only that request's status from
`pending` to `resolved`. The Runtime session was active, agent-controlled,
attached, and owned at acceptance.

The task then stopped before an external mutation and reported: **Task
capability launch context mismatch.** It explicitly reported that no repository
or issue was created and no task-browser screenshot was captured. The stop rule
was applied immediately. No follow-up was sent, no alternative connector or
direct site route was attempted, and no second task or journey was started.
Because the task browser never produced navigated site state, there are no
repository or issue URLs, checklist/assignee/label/closed-state verification,
history/tab results, or external screenshot. The native surface exposed one
session-start observation and zero evidence items but did not expose the
observation identifier; no internal Runtime endpoint or persisted-state read
was used to retrieve it.

The failure screenshot is
[`artifacts/p5.9-live-acceptance/gate-a-retry-stop-capability-launch-context-mismatch.png`](artifacts/p5.9-live-acceptance/gate-a-retry-stop-capability-launch-context-mismatch.png)
(SHA-256
`ba0970c9a2d48be1fe6ca8039933a0217c31431e3e975334193539280fc1e055`).

Normal **Finish** converged the new task and Runtime to closed/completed truth.
The task was then archived through its normal **Archive** action. Final product
truth retained both historical tasks as closed and archived, omitted
`currentTaskId`, reported no companion session or product error, restored the
empty New task composer, and showed zero observations/evidence for the selected
terminal task. Both Runtime projections reported controller `null`, attachment
`missing`, and profile ownership `released`. The cleaned screenshot is
[`artifacts/p5.9-live-acceptance/gate-a-retry-stop-capability-cleaned.png`](artifacts/p5.9-live-acceptance/gate-a-retry-stop-capability-cleaned.png)
(SHA-256
`c8d1cdc70f8616b83ba7e28ab9d1cda7339b0354ac50d2301b6604b29a14c83c`).
Desktop PID 10570 and Runtime PID 10595 were verified absent after normal
close.

No external mutation is evidenced, but independent site-state verification was
not possible because task-browser launch failed before navigation. Gates B-F
were not started. No package, publication, commit, staging, CUA, coordinate
action, direct task-browser automation, DevTools, site API, shell HTTP,
external connector, or web search was used. This stopped retry is returned for
Master review and is not self-accepted.

## Task-bound launch-context correction

The Gate A retry failed because the task-scoped MCP client required byte-for-byte
browser-identity equality. The host bound the task to the selected persistent
workspace as `{ mode: "workspace", workspaceId }`, while `session.start` may
legitimately express the already selected workspace as `{ mode: "workspace" }`
after normal tool-input parsing. The scoped client therefore rejected a valid
selected-workspace request before returning the existing task session.

The corrected boundary treats `session.start` as an existing-session lookup,
never as session-selection or creation authority. A workspace-bound task now
accepts an omitted browser selector, workspace mode without an id, or the exact
bound workspace id; a temporary-bound task accepts only the exact temporary
identity. Wrong execution modes, temporary/workspace crossover, wrong workspace
ids, malformed identities, extra selectors, bootstrap ids, and attempts to
address another session remain rejected. `startUrl`, when present, navigates
only the already-bound session before that same session is returned. The
underlying unscoped `startSession` is never called.

Every host-owned `thread/start` and `thread/resume` request now carries
`developerInstructions` derived from one exported, versioned base route-policy
constant and the frozen task context. It directs the task to use only Rove
session, observation/interaction, evidence, history, tab, download, and upload
routes for browser work, never substitute connected apps, web search, Computer
Use, shell, site APIs, or another browser path, and stop/report on route failure
or external uncertainty. The derivation states the exact execution mode. For a
workspace-bound task it instructs `session.start` to omit browser/workspace
selection so the already-bound workspace is used; for a temporary-bound task it
instructs `session.start` to send `browser {"mode":"temporary"}`. It never
includes a workspace id or local path. The ordinary user outcome remains
byte-for-byte unchanged. The same parameter builders cover initial start,
normal resume, bootstrap recovery, and restart recovery. The handwritten
protocol types expose only the exact `developerInstructions?: string | null`
fields supported by pinned App Server 0.153.4, and the generated runtime schema
accepts the actual start and resume wire values.

Focused MCP runtime/session, coordinator, generated-protocol, recovery, product
API, and intent tests passed 88/88 across nine files; the two Runtime-client
cases initially hit the sandbox's loopback `EPERM` and passed unchanged with
loopback permission. The directly affected focused subset passed 57/57. P5.9
L0 passed 56,231 assertions, P5.0 passed 75/75 fixtures, P5.9 L2 passed all
eight production-equivalent scenarios with clean terminal cleanup, and the
safe isolated required-MCP live boundary passed catalog, task binding,
mismatch rejection, typed-content, and unavailable-required-server checks.
Repository typecheck, lint, source build, changed-file Prettier, and whitespace
checks passed.

The source-built canonical-home preflight was read-only: the empty composer was
visible with **Start task** disabled, account truth was
`logged_in`/`chatgpt`/`plus`, persistent workspace
`wrk_0d22b405-5c2a-431e-929e-29b8822e2e35` (`Rove Live Acceptance
20260908-1619`) was selected, both retained tasks were closed and archived, and
there was no product error or recovery warning. No outcome was entered and no
task, thread, turn, Runtime session, browser navigation, or external mutation
was created. The preflight screenshot is
[`artifacts/p5.9-live-acceptance/gate-a-launch-context-correction-preflight.png`](artifacts/p5.9-live-acceptance/gate-a-launch-context-correction-preflight.png)
(SHA-256
`87816707b84bc1978b64e0dd4355785ae9d7b9c1b1bc3828e47972bb09635815`).
Desktop PID 30399 and Runtime PID 30426 were verified absent after normal
close.

Residual uncertainty: the pinned App Server schema exposes the explicit
`web_search: "disabled"` and Computer Use denial already applied by Rove, but
this inspection found no documented exact config field that disables every
possible inherited connected-app, shell, or site capability. No field was
invented. The new developer instruction supplies the host-owned behavioral
policy; it is not claimed as a transport-level removal of capabilities not
covered by those explicit config denials. Gate A was not resubmitted. This
correction is returned for Master review and is not self-accepted.

### Master-review frozen-selection correction

Master review identified that the initial generic instruction did not reveal
which frozen execution mode and browser-identity choice applied. The pure
`browserRouteDeveloperInstructions()` builder now receives only the immutable
context's `executionMode` and `browserIdentity`; it does not consult renderer
defaults or current workspace selection. Table-driven tests cover
Agent+workspace, Companion+workspace, Agent+temporary, and
Companion+temporary. For all four cases, `thread/start` and `thread/resume`
carry identical selection-specific instructions, the generated 0.153.4 schemas
accept both wire payloads, no workspace id or local path appears, and the user
outcome remains the sole unchanged user-turn input. The previous scoped-session
equivalence, mismatch, and strict temporary-identity tests remain intact.

The updated focused campaign passed 60/60 tests across the four directly
affected files, plus 6/6 startup/recovery tests. Typecheck, lint, source build,
changed-file Prettier, JSON validation, and whitespace checks passed. The
required-MCP implementation and lifecycle logic did not change, so the already
passing non-mutating required-MCP probe was not repeated, and per Master
direction P5.9 L0, P5.9 L2, and P5.0 were not repeated. No external task,
package, direct state change, or browser interaction occurred. This follow-up
is returned for Master review and is not self-accepted.

## Master-accepted launch correction: Gate A authentication stop

After Master accepted the task-bound session-start and frozen-selection route
correction, the source-built Desktop restarted against the canonical product
home for Gate A only. The signed-in `chatgpt`/`plus` product account and
persistent workspace `wrk_0d22b405-5c2a-431e-929e-29b8822e2e35` (`Rove Live
Acceptance 20260908-1619`) were selected. Exactly one Agent task was submitted
through the normal composer with the fresh reserved repository name
`rove-phase5-live-20260908-1746-ng` and ordinary outcome-only prose.

The task projected product task
`task_8cb9ede0-0784-4ea3-87f7-c5fbb065df71`, Codex thread
`01a081ea-684e-7952-813f-91ea8f09e2ee`, Codex turn
`01a081ea-739d-7af0-99f1-8abb53431c66`, and Runtime session
`ses_1f2781bbad6146748096e6369b7d0786`. The expected session-start request
`codex_4619e0aecb6948c4847b9f14f79be0f5:server:0`, generation 1, was accepted
exactly once through the native **Approve / Send** control. Its identity was
preserved, its status changed from `pending` to `resolved`, and task-bound
`rove/session.start` completed successfully. This proves the prior launch
context mismatch is corrected in the accepted Agent+workspace path.

The required task route then reached GitHub authentication and invoked a human
handoff with reason: **The page requires authentication that must be completed
by a human.** The task reported that it stopped at GitHub authentication and
that no repository or issue had been created. The first-failure rule was
applied immediately. No takeover, return, follow-up, alternate integration, or
second task was attempted.

At the stop, native truth showed three observations and two evidence items, an
attached task browser, status `awaiting_human`, controller `null`, and no
product error. The product surface exposes counts but not observation or
evidence identifiers, so their ids could not be recorded without a prohibited
internal-state read. Because authentication blocked site access before the
first mutation, there is no repository or issue URL, checklist/assignee/label
state, history/tab result, final issue viewport screenshot, or independent
site-state verification.

The authentication-stop screenshot is
[`artifacts/p5.9-live-acceptance/gate-a-retry-stop-github-authentication-required.png`](artifacts/p5.9-live-acceptance/gate-a-retry-stop-github-authentication-required.png)
(SHA-256
`23b67a1c9a53329a68dc681adda404aafbcc024a5fded7074ae7f1353ef95ff6`).
Normal **Finish** converged the task to closed Runtime truth under operation
`intent_10cd871d-240a-47b6-b4bf-fdd53d2c6257`, after which normal **Archive**
archived the conversation. Final truth showed no companion session or current
task, Runtime `completed`, controller `null`, attachment `missing`, profile
ownership `released`, no recovery warning, and no product error. The cleaned
screenshot is
[`artifacts/p5.9-live-acceptance/gate-a-retry-stop-github-authentication-cleaned.png`](artifacts/p5.9-live-acceptance/gate-a-retry-stop-github-authentication-cleaned.png)
(SHA-256
`0ce619b0e1a54251adcf71f16c3d7fe56c620a6bf0890b3bf827ece2cd8473ab`).
Desktop PID 35913 and Runtime PID 35938 were verified absent after normal
close.

No CUA, Computer Use, coordinates, direct task-browser automation, DevTools,
site API, shell HTTP, external connector, or web search was used. Gates B-F
were not started, and no package, publication, commit, or staging action
occurred. Gate A remains stopped on missing GitHub authentication in the named
persistent workspace and is returned for Master review without self-acceptance.

## Independent public Maps gate: inspection-consent stop

The source-built Desktop restarted against the canonical product home for the
public Maps journey only. The `chatgpt`/`plus` product account and existing
persistent workspace `wrk_0d22b405-5c2a-431e-929e-29b8822e2e35` (`Rove Live
Acceptance 20260908-1619`) were selected. Exactly one Agent task was submitted
through the normal composer with ordinary outcome-only prose. Gmail/Calendar,
Drive, PDF, combined, and GitHub journeys were not started.

The run projected task `task_b68515df-2ad0-4be5-b7ca-2e8c191085bd`, Codex
thread `01a081f1-4ad8-7fb1-8090-052c1039d6b5`, Codex turn
`01a081f1-567b-7d51-a6c9-bb2b4de13be0`, and Runtime session
`ses_3efa167db24e462f90caf9302ae3c4b6`. The expected session-start request
`codex_4825955b1e27445fb0eb2f330eff1756:server:0`, generation 1, was accepted
exactly once through native **Approve / Send**. Its identity was preserved and
task-bound `rove/session.start` completed.

Before site inspection completed, the product presented a second consent
request, `codex_4825955b1e27445fb0eb2f330eff1756:server:1`, for
`rove/browser.inspect`. The gate authorized only the expected session-start
elicitation and required an immediate stop on consent, so this second request
was never approved or declined. It remained `pending` at the recorded stop and
was resolved only as part of normal task interruption/finish cleanup. No
workaround, takeover, follow-up, or alternate route was attempted.

At the stop, the surface showed two observations and two evidence items, an
active attached Agent-controlled Runtime session, the pending inspect request,
and no product error. Normal output did not expose observation or evidence ids.
Because the inspection consent blocked fresh Maps state, the destination,
place panel, map zoom, visual controls, route endpoints/options, route-view
description, tab/history state, and task-captured viewport screenshots are all
unverified. No navigation, save, sign-in, or account-setting action is
evidenced.

The stopped-state screenshot is
[`artifacts/p5.9-live-acceptance/gate-maps-stop-browser-inspect-consent.png`](artifacts/p5.9-live-acceptance/gate-maps-stop-browser-inspect-consent.png)
(SHA-256
`a62716c563a6ccca262a6e003ed95f6f0a413ce9160acc0b32707dfb1132c190`).
Normal **Finish** interrupted the turn and converged task/Runtime cleanup under
operation `intent_690aee89-90bc-44f6-929c-f307292d05fa`; normal **Archive**
then archived the conversation. Final truth showed lifecycle `closed`, Runtime
`completed`, controller `null`, attachment `missing`, profile ownership
`released`, no current task or companion session, no recovery warning, and no
product error. The cleaned screenshot is
[`artifacts/p5.9-live-acceptance/gate-maps-browser-inspect-consent-cleaned.png`](artifacts/p5.9-live-acceptance/gate-maps-browser-inspect-consent-cleaned.png)
(SHA-256
`ffd1529fcc4423def035b5b59b71bb211d52382b19b95af373584b2c23a0009f`).
Desktop PID 47756 and Runtime PID 47781 were verified absent after close.

No CUA, Computer Use, coordinates, direct task-browser automation, DevTools,
Google API, web search, connector, shell HTTP, external browsing, package,
publication, commit, or staging action was used. This independent Maps gate is
returned stopped for Master review and is not self-accepted.

## Product permission-review correction

Investigation of the repeated MCP consent prompts found that Rove supplied
`approvalPolicy: "on-request"` but omitted `approvalsReviewer`. Codex App
Server therefore retained its human-review default (`"user"`) for every MCP
request. The product now exposes the exact choices **Approve for me**
(`"auto_review"`) and **Always ask** (`"user"`) beside the existing launch
selectors. A new composition defaults to **Approve for me**. Its explanatory
copy states that routine eligible requests are reviewed automatically while
important handoffs can still pause; Capture explicitly states that permission
review is unused because Capture starts no Codex turn.

The selected reviewer is now part of the immutable task policy, launch intent,
product projection, durable serialization, and all `thread/start` and
`thread/resume` requests. Product API serialization advanced to version 5 and
durable task-context serialization advanced to version 4. Missing reviewer
fields in legacy version-2/version-3 task state migrate conservatively to
`"user"`; explicit null, unknown, or otherwise invalid values are rejected.
Duplicate launch with a different reviewer is also rejected as an immutable
context conflict.

App Server's effective `approvalsReviewer` response is checked against the
frozen requested value before a started, resumed, or crash-recovered thread is
accepted. A mismatch, null, or unsupported response fails closed. Crash-cut
thread discovery now resumes with the frozen configuration before binding, so
recovery cannot bypass this check. `approvalPolicy: "on-request"`, sandbox
`"workspace-write"`, required Rove MCP validation, browser-route policy,
attention handling, and human-control handoffs remain unchanged.

The focused permission-review and adjacent recovery campaign passed 100/100
tests across seven files. The generated App Server contract subset passed
7/7 tests, the P5.0 compatibility campaign passed 75/75 fixtures, and the full
repository suite passed 931/931 tests across 142 files. Full typecheck, lint,
source build, changed-file Prettier, and whitespace checks passed. This
correction did not launch a task, browser session, external journey, or
package. It makes no new live-acceptance claim and is returned for Master
review without self-acceptance.

## Independent source-built permission-review live qualification

The source-built Desktop started from the canonical local product state with
managed services. Preflight showed the clean composer, no active task or
Runtime session, the signed-in `chatgpt`/`plus` account, and selected workspace
`Rove Live Acceptance 20260908-1619` /
`wrk_0d22b405-5c2a-431e-929e-29b8822e2e35`. The visible **Permission review**
selector was **Approve for me** (`auto_review`) before launch. No approval or
attention control was clicked during the run.

Exactly one Agent task was submitted through the normal product composer with
the required ordinary outcome-only Maps prompt. It produced task
`task_bbfb66b9-194f-493e-8762-8490399e3caa`, Codex thread
`01a08208-7212-7e82-ab42-5c365fd64962`, Codex turn
`01a08208-7e0a-7231-a624-d031e99f6b86`, and Runtime session
`ses_d08c4f0cc9d44344b9cf6106b2ddf68f`. Product truth projected
`approvalsReviewer: "auto_review"`; because thread binding now rejects a
different App Server response, the accepted thread also confirms the retained
reviewer matched. There was no product error or recovery warning.

`rove/session.start` item `exec-08ded493-44de-44ce-acac-74261eafec12` and
`rove/browser.inspect` item `exec-edc22e55-d9ac-4927-bcd3-0480a7ebba73`
both completed without a visible human approval prompt. No Codex approval or
MCP-elicitation entry for this task appeared in product attention truth, so
automatic review produced no user-facing request identity. This is the
positive live result for the permission-review correction: both MCP calls that
previously prompted were admitted without manual review.

Google Maps then presented a cookie-consent page. Rove captured viewport
evidence and requested genuine human control instead of choosing a consent
preference. Per the qualification stop rule, **Take Over** was not clicked and
the route journey did not continue. The handoff request was
`control:ses_d08c4f0cc9d44344b9cf6106b2ddf68f:handoff_447ba47297d740a0907078722d9434b0`,
generation 2, backed by handoff
`handoff_447ba47297d740a0907078722d9434b0`. At the stop Runtime truth was
`awaiting_human`, controller `null`, attachment `attached`, with four
observations and three evidence items.

The task-reported bounded evidence was observation
`bobs_5b30b20c58ca448d8ee356dd8cb5daea`, navigation
`nav_3e9bbf30b0e74cfa8a189795893ffe19`, navigation evidence
`ev_c3062f9c16744696bc29a0dd91b47c75` and
`ev_b98f595c9b3c44bb84190c802114a815`, and consent-page viewport screenshot
`ev_980f2f6a75f34355a9e1b9bc6a79b196`; there were no action receipts. The
Rove screenshot item was `exec-89796a0b-79d3-40c0-8718-261fbde10483`.
Because the stop preceded route entry, King's Cross, The British Museum,
public-transit mode, and route duration remain unverified. The screenshot is
of the consent page, not a final route.

The native stopped-state record is
[`artifacts/p5.9-live-acceptance/gate-maps-auto-review-stop-cookie-consent-handoff.png`](artifacts/p5.9-live-acceptance/gate-maps-auto-review-stop-cookie-consent-handoff.png)
(SHA-256
`1054ae74510fe46e0a64e9aececfbab0a513f377b13b9cd8ab8bb7da5efc6292`).
Normal **Finish** converged the task under operation
`intent_5aa8ceca-95a1-4394-9acd-e2646fce7b88`, and normal **Archive** set
the conversation archived. Final product truth showed lifecycle `closed`,
Runtime `completed`, controller `null`, attachment `missing`, profile ownership
`released`, no companion session, no current task, no recovery warning, and no
product error. Desktop PID 81104 and Runtime PID 81137 were verified absent
after normal close.

No CUA, Computer Use, coordinates, DevTools, direct task-browser automation,
site API, web search, external connector, shell HTTP, package, staging, commit,
or publication was used. The automatic-review behavior is live-qualified, but
the requested Maps route journey stopped correctly at genuine cookie consent.
This evidence is returned for Master review and does not self-accept P5.9 or
Phase 5.

## Post-qualification product-truth and viewport corrections

Master review of the automatic-review stop found three contradictory product
projections plus an unreachable-content risk. Each had an independent root
cause and was corrected without launching another external journey.

The stopped handoff appeared `stale` because App Server `turn/completed`
terminalized every attention entry bound to the turn, including the
independent `rove_control` handoff whose Runtime continuation intentionally
survives turn completion. Turn terminalization is now restricted to Codex
server requests. Rove handoffs remain pending until authoritative Return,
cancel, or task close. Startup reconciliation also repairs a previously
corrupted stale Rove handoff when the durable continuation still identifies it
as active, covering the exact state created by the qualification run.

The Browser & evidence card mapped every non-human controller, including
`null`, to **Agent** through a two-way renderer ternary. Full, expanded, and
chip presentation behavior now derives handoff/controller actions from the
current product task's Runtime projection plus its exact pending Rove
attention. A `null` controller while Runtime is `awaiting_human` is displayed
as **Controller: Awaiting handoff**; Take Over is exposed only for that exact
current pending handoff. Historical tasks cannot inherit live takeover or
pause actions from the companion-session projection.

The five-task composer warning was downstream of Runtime inventory, not the
composer counter. A newer session's legitimate lock on a shared workspace was
reported as `conflicting` for every older terminal session. Lifecycle
projection consequently reopened four closed, archived tasks as cleanup
blockers. Runtime now treats a terminal session as released when a different
session in the same Runtime instance owns that exact workspace lock, while
retaining cleanup-required truth for malformed locks or a lock still owned by
the terminal session itself. Four closed and archived histories plus one active
task therefore produce one blocker; after normal cleanup they produce zero.

The full surface previously gave its grid only a minimum viewport height while
the body suppressed overflow, so content enlarged the grid instead of
activating its scroll regions. The product root and grid now have bounded
height/min-height geometry. Conversation and status columns are independently
keyboard-focusable vertical scroll regions with contained overscroll and no
horizontal overflow. Expanded presentation remains vertically usable under a
small follower window; chip presentation stays non-scrolling.

Focused regression coverage now includes originating-turn completion while
Runtime is awaiting human control, durable stale-handoff repair, authoritative
controller/takeover truth, full/expanded/chip presentation behavior, four
closed archived histories with one active blocker and zero after cleanup, the
terminal/shared-workspace inventory case, and long conversation rendering.
The focused campaign passed 30/30 checks. The full repository suite passed
937/937 tests across 142 files; P5.0 fixtures passed 75/75. Full typecheck,
lint, source build, changed-file Prettier, and whitespace checks passed.

The local renderer visual campaign also passed. Its constrained 760×420 case
proved both columns were scrollable and could reach their bottoms, the document
had no horizontal overflow, and no chip scroll container leaked into the full
surface. The rendered record is
[`artifacts/p5.6-p5.7-product-surface/full-constrained-long-content.png`](artifacts/p5.6-p5.7-product-surface/full-constrained-long-content.png)
(SHA-256
`6bcc1afdff004f649fade42a6b50f2641415684eabf41222cd6ea027efd8c3df`).
The handoff visual is
[`artifacts/p5.6-p5.7-product-surface/full-active-handoff.png`](artifacts/p5.6-p5.7-product-surface/full-active-handoff.png)
(SHA-256
`308fbbb06643f17c3c2c472404d51d8c1114639207e6e55b349719404b5cffb4`).
It shows the corrected awaiting-handoff label and only the valid Take Over
control.

No external site, task browser, package, publication, commit, or staging action
was performed for these corrections. The earlier Maps journey remains stopped
at genuine cookie consent. This correction set is returned for Master review
and is not self-accepted.

## Independent public research, multi-tab, history, PDF, and download gate

The source-built Desktop restarted against canonical local product state for
this gate only. Preflight showed the normal composer with no active task or
Runtime session, no blocker warning, no recovery warning or product error, the
signed-in `chatgpt`/`plus` account, selected persistent workspace `Rove Live
Acceptance 20260908-1619` /
`wrk_0d22b405-5c2a-431e-929e-29b8822e2e35`, and visible **Permission review:
Approve for me** (`auto_review`). The full task workspace was usable. Exactly
one Agent task was submitted with the delegated ordinary outcome-only prose.

The run created task `task_7ce27622-3384-48e9-b944-c4c7a30bc065`, Codex
thread `01a08220-ea99-7dc1-8d26-64739506f966`, turn
`01a08220-f5c8-7612-bb78-23c8bea3f162`, and Runtime session
`ses_1d639e93f07843908febfc529d7fc2a6`. Product truth projected
`approvalsReviewer: "auto_review"`. `rove/session.start`, inspection,
grounding, navigation, history, tab, screenshot, scroll, and interaction calls
ran without a user-facing approval request for this task. During execution the
composer named exactly this task as its single blocker and Browser & evidence
truth showed controller **Agent**.

The task reached the official IRS source page
`https://www.irs.gov/forms-pubs/about-form-w-4`, followed its **2026 Form W-4
(PDF)** link, and verified the separate PDF URL
`https://www.irs.gov/pub/irs-pdf/fw4.pdf`. The embedded document visibly
identified **2026 Form W-4, Employee's Withholding Certificate**, Department
of the Treasury—Internal Revenue Service, OMB 1545-0074. The final tab report
was `page_01` on the inactive IRS source page at revision 5 and `page_02` on
the active PDF at revision 1. History was exercised source → PDF → Back →
source → Forward → PDF → Back → source, followed by explicit PDF → source →
PDF tab switching. A 1,100-pixel embedded-viewer scroll changed the visible
page indicator from **1/5** to **2/5**.

The required download did not dispatch. Rove rejected the proposed interaction
before browser execution because `download_created` is not an admitted
expected-effect type. Per the first-failure rule, the task stopped without a
retry, alternate download route, or other workaround. No download identifier,
managed filename, byte size, or MIME type exists, and the requested final
task-browser screenshot was not captured. The earlier page-1 viewport evidence
is `ev_56e1e84200dc4efea96c114cb75ed026`.

The task reported source observations
`bobs_82c5a027cb684074913ef9844f373bf1` and
`bobs_34461a1903c74155b4bade6fb5757630`, link successor observation
`bobs_5dcc2c85d44a4e1ab3ebe5c2f862024a`, page-1 observation
`bobs_15c85a458a87488b8beb319c4a362775`, page-2 observation
`bobs_4ba944b6024f45b7a1d6a30cfeb7b7f8`, link action receipt
`rcpt_dc0df8fe3dd44f749f67a462846faaa4`, and navigation identifiers
`nav_c991b550dc5a499cb3b3486e9a0f4d89` and
`nav_925e4cb744274488a93a408c918b2485`. Product truth counted 11 observations
and nine evidence items at the stop. History, tab, and scroll calls exposed no
identifiers in the task report, while the normal product surface exposed only
aggregate counts, so the reported identifier list is explicitly incomplete
rather than inferred.

The stopped native screenshot is
[`artifacts/p5.9-live-acceptance/gate-irs-pdf-stop-unsupported-download-effect.png`](artifacts/p5.9-live-acceptance/gate-irs-pdf-stop-unsupported-download-effect.png)
(SHA-256
`c7629aac6ec954d8d4fcbcf1879afcb212ea8c7fc41735b01288a5ac01c0aa18`).
Focusing the bottom follow-up control through the normal product surface moved
the independently scrollable task column to its end, proving the long progress
list, composer control, Finish action, and one-blocker warning remained
reachable. That native record is
[`artifacts/p5.9-live-acceptance/gate-irs-pdf-stop-long-content-bottom.png`](artifacts/p5.9-live-acceptance/gate-irs-pdf-stop-long-content-bottom.png)
(SHA-256
`c1b0ebd80e50fb474a556c547a171b12ab83be931917d47b769daa5fa250a5d7`).

Normal **Finish** converged under operation
`intent_278cfc5c-7d70-4551-89f5-31f045c866d6`; normal **Archive** then
archived the completed conversation. Final product truth showed lifecycle
`closed`, Runtime `completed`, controller `null`, attachment `missing`, profile
ownership `released`, no current task or companion session, zero blockers, no
recovery warning, and no product error. Historical Browser & evidence truth
displayed **Controller: None**. The cleaned screenshot is
[`artifacts/p5.9-live-acceptance/gate-irs-pdf-unsupported-download-cleaned.png`](artifacts/p5.9-live-acceptance/gate-irs-pdf-unsupported-download-cleaned.png)
(SHA-256
`724d8a421d8188cb7c222a7be4ff70cbcc074a55dc566ef74d616334e294ac0c`).
Desktop PID 23951 and Runtime PID 23976 were verified absent after normal
close.

No CUA, Computer Use, coordinates, DevTools, direct task-browser automation,
site API, web search outside the task, external connector, shell HTTP, package,
staging, commit, or publication was used. The source, PDF identity, history,
tabs, and visible PDF page change passed, but the gate remains stopped before
managed download and final task-browser screenshot. This partial evidence is
returned for Master review and does not self-accept P5.9 or Phase 5.

## Post-gate download expected-effect correction (local only)

The stopped PDF gate exposed a foundational contract gap rather than an
IRS-specific problem. BrowserSession already captured managed downloads and
Runtime already persisted file evidence plus a `download_completed`
observation, but verified interactions had no public download effect and no
action correlation across those layers. The atlas also called managed download
capture complete while its governance checked only inventory shape and parity
with the pre-existing effect union; it did not make the row's promised “origin
action” evidence mechanically auditable.

The bounded correction adds the single canonical public effect
`download_completed`, optionally matched by an exact pre-dispatch filename. A
fresh action boundary is registered before dispatch, carried by the production
BrowserSession activity, and resolved only after Runtime file-evidence and
observation persistence. Exact completion returns `applied` with both durable
IDs on the receipt effect. Correlated failure or filename mismatch is
contradicted; timeout, lost correlation, or persistence failure is unresolved
and therefore `unknown`. The existing one-shot consequence replay fence remains
authoritative, and no verification path redispatches.

Local fixture coverage includes immediate and slow completion, exact filename
match and mismatch, old evidence not satisfying a new boundary, timeout,
single dispatch/artifact, replay without redownload, ownership-generation
invalidation and fencing, BrowserSession boundary propagation, MCP schema,
protocol, and atlas governance parity. The dedicated
trace and experiment record is
[`2026-09-08-download-expected-effect-foundation.md`](2026-09-08-download-expected-effect-foundation.md).
This section records diagnosis and local implementation only. The external
PDF/download gate was not retried and remains unaccepted.

Post-correction verification passed: protocol/MCP/semantic focused tests 34/34,
capability waves 51/51, MCP process E2E 2/2, P5.0 fixtures 75/75, and the full
repository suite 946/946 across 142 files. Full typecheck, lint, source build,
changed-file formatting, and whitespace checks also passed. The production
tool-definition JSON-wire pin at that correction stage was
`9072c9dd6893c674f53806cc7306271826dc516664e5f937048bf39dd7db99c6`;
the later browser-inspection description correction below supersedes it.

## Causal-correlation correction and local PDF viewer qualification

Review of the first download foundation found that a mutable page boundary
could still let an overlapping prior download satisfy a later action. The
correction replaces that behavior with a bounded single-use correlation
window: a direct anchor requires the resolved URL plus exactly one matching
trusted activation, and an overlapping same-URL programmatic activation is
ambiguous. Runtime now arms its waiter only after all pre-dispatch checks and
immediately before BrowserSession dispatch; a deterministic BrowserSession
target-resolution rejection proves the registered waiter is cancelled and no
BrowserSession window survives. Multiple
`download_completed` expectations and non-click use are rejected before
Runtime dispatch.

Official Playwright and Chromium protocol surfaces do not expose a general
initiating-DOM-target/action identity on a download. Arbitrary no-href buttons
therefore return `DOWNLOAD_CORRELATION_UNAVAILABLE` while still preserving any
managed artifact. A headed local production-path experiment did, however,
qualify Chromium's built-in PDF viewer narrowly: exact `Download` button in the
built-in extension frame, main document MIME `application/pdf`, and completion
URL equal to the pre-dispatch PDF URL. The local fixture PDF produced an
`applied` receipt with durable observation/evidence IDs and persisted
`chromium_pdf_viewer` correlation audit data.

This corrects the identified local causal and PDF-viewer contract gaps. The
external IRS journey was not retried, so its prior stop remains the accepted
historical result and the external gate remains open pending a fresh delegated
run. Detailed evidence and source links are in
[`2026-09-08-download-expected-effect-foundation.md`](2026-09-08-download-expected-effect-foundation.md).

Final correction verification passed: focused download/PDF coverage 13/13,
capability waves 52/52, semantic transactions 127/127, MCP process E2E 2/2,
P5.0 fixtures 75/75, and the full repository suite 951/951 across 142 files.
Full typecheck, lint, source build, changed-file Prettier, and whitespace checks
also passed.

## Fresh external IRS/PDF retry after the local correction

Master accepted the local download/correlation foundation and authorized one
fresh external acceptance attempt through the source-built Rove Desktop. The
native product surface launched in `canonical_os_home` mode with Desktop PID
56420 and managed Runtime PID 56444. Preflight showed a clean composer,
App Server account `logged_in` through ChatGPT on the `plus` plan, the selected
Chrome workspace **Rove Live Acceptance 20260908-1619**
(`wrk_0d22b405-5c2a-431e-929e-29b8822e2e35`), Agent mode, `gpt-6-astra` at
`low` effort, and `auto_review` permission review.

Exactly one product task was launched:

- product task `task_da53da68-be9c-43b8-aff3-96610532be08`;
- Codex thread `01a08267-c006-76f0-a21c-72e974a4cf12`;
- turn `01a08267-cacc-7043-a141-32092d86953b`;
- Runtime session `ses_6801e2143e6644ef9af97e48e3f74b0d`;
- bootstrap `boot_276325766d694acc8f8799168f4d3c3a`;
- browser `browser_5efbdfcd-6557-40ef-87f0-91ce0d4ad78b`;
- page `page_01`;
- observation `bobs_3df01fd86896457abd8eb124b7876544`;
- navigation `nav_21cc9816a7db41f6b585041ad885e1bc`.

The delegated task used only the Rove custom MCP for the managed browser. It
started the session, inspected the official IRS Form W-4 source page, and then
attempted to resolve the visible **Form W-4 PDF** target. That required
grounding step returned `ambiguous` with reason
`best_candidate_not_actionable`, so the task stopped at the first failure as
required. The source page was verified and the external browser navigated to
it, but the PDF was not opened. Back/Forward, tab switching, PDF scrolling,
the task-browser screenshot, and the download were not attempted. Download
click count is zero; there is no download receipt, artifact, or file mutation;
and consequence key `irs-fw4-pdf-download-20260908` remains unused.

The native stopped-state screenshot is
[`artifacts/p5.9-live-acceptance/gate-irs-pdf-retry-stop-target-ambiguous.png`](artifacts/p5.9-live-acceptance/gate-irs-pdf-retry-stop-target-ambiguous.png)
(SHA-256
`abea07d18158ea24b92c515e970d45a4ac35cca543bd9f54a919eb94d02762cc`).
This is product-surface evidence; the delegated task did not reach its requested
task-browser viewport screenshot.

Normal **Finish** converged under operation
`intent_0d8d6e65-6485-4e61-9eaa-a24de0af2cd1`, after which normal
**Archive** removed the remaining archive action. Final product truth showed
lifecycle `closed`, Runtime `completed`, controller `null`, attachment
`missing`, profile ownership `released`, no available task actions, no recovery
warnings, and no product error. The historical task surface showed zero current
observations, zero current evidence, and **Controller: None**. The cleaned
native screenshot is
[`artifacts/p5.9-live-acceptance/gate-irs-pdf-retry-target-ambiguous-cleaned.png`](artifacts/p5.9-live-acceptance/gate-irs-pdf-retry-target-ambiguous-cleaned.png)
(SHA-256
`11ddfd91e309a4e23c6c275be79988e3ce8ee8617d4acf97d2a3a927a5135b90`).
Desktop PID 56420 and Runtime PID 56444 were verified absent after normal
close.

The native harness controlled only the Rove Electron renderer. The delegated
task used only Rove MCP for its managed browser; no CUA, Computer Use,
coordinates, Playwright/DevTools access to the managed browser, LocalProductApi
bypass, shell HTTP, site API, external connector, package, staging, commit, or
publication was used. The local foundation remains accepted, but this fresh
external gate is stopped and unaccepted because target grounding failed before
the PDF and download journey.

## Post-stop bounded target-text grounding correction (local only)

The fresh stop was traced to target-name ranking, not perception or canonical
target registration. Observation `bobs_3df01fd86896457abd8eb124b7876544`
correctly exposed `t37` as a visible, enabled, in-viewport link named
**2026 Form W-4 (PDF)** with `activate` capability under the **Current
revision** card. The delegated intent requested **Form W-4 PDF** with
`activate`. Existing normalization preserved the parentheses, so neither
normalized string directly contained the other. Every activate-capable target
therefore retained the same capability-only rank; the first candidate was
non-actionable and produced `best_candidate_not_actionable`.

The local correction preserves exact-name and normalized direct-substring
ranking as the two strongest text classes, then adds one weaker bounded
fallback. That fallback NFKC-normalizes, case-folds, and segments Unicode
letters and numbers. It contributes `partial_name_match` only when either
token list occurs as an ordered contiguous whole-token sequence in the other.
It does not use edit distance or fuzzy similarity. Empty or symbol-only text
contributes no evidence, punctuation remains a boundary so `A/B` cannot match
`AB`, and a stronger non-actionable exact or direct-substring candidate still
blocks a weaker actionable token-sequence candidate.

Deterministic unit coverage uses the generic intent **Quarterly Report PDF**
against the actionable accessible name **2026 Quarterly Report (PDF)** among
many unrelated activate-capable controls and requires selection of the exact
target with `partial_name_match`. It also covers the inverse containment
direction, punctuation and token-boundary negatives, symbol-only inputs,
stronger non-actionable blocking, and the pre-existing tie behavior. The
integration fixture limits the presented target inventory so the desired link
is omitted, then proves the complete canonical target authority still selects
it with the same partial-name evidence.

Verification after the correction passed: focused grounding 18/18, focused
grounding/inspection/browser coverage 88/88, capability waves 52/52, P5.0
fixtures 75/75, and the clean full repository suite 959/959 across 142 files.
Full typecheck, lint, source build, changed-file Prettier, and whitespace checks
passed. One earlier full-suite attempt recorded an unrelated existing temporal
test timing miss at 227.9 ms against a 240 ms lower bound; the isolated test
then passed 3/3 and the two subsequent complete suites passed cleanly at
958/958 and 959/959 after the final symbol-only guard.

This is a general accessible-name grounding contract correction with no
site-specific text or IRS-specific branch. The external IRS/PDF journey was not
retried, no managed-browser state was changed, and the gate remains stopped and
unaccepted pending independent Master review.

## Fresh external retry after target-name acceptance

Master independently accepted the bounded target-name correction after a
49/49 focused resolver/browser gate, the 75/75 P5.0 oracle, and a clean 959/959
full repository suite. Master also replayed the prior IRS observation and
confirmed that intent `{text: "Form W-4 PDF", capability: "activate"}` now
selects actionable `t37`, **2026 Form W-4 (PDF)**, with
`capability_match`, `partial_name_match`, and `actionable` evidence.

One source-built native-surface launch encountered the PTY's bounded canonical
input length while filling the requested outcome. The line was truncated before
the harness received valid JSON, so no renderer command completed, no Start
action occurred, and no product task or managed browser session was created.
That launcher-only attempt was closed before a clean relaunch and is not a
journey attempt.

The clean relaunch used `canonical_os_home`, App Server 0.153.4, the logged-in
ChatGPT `plus` account, Agent mode, `gpt-6-astra` at `low` effort,
`auto_review`, and persistent Chrome workspace **Rove Live Acceptance
20260908-1619** (`wrk_0d22b405-5c2a-431e-929e-29b8822e2e35`). Its managed
Runtime PID was 23173. Exactly one product task was started:

- product task `task_66a93823-c971-4d22-955f-f610e9c68f60`;
- Codex thread `01a08280-2f39-7b31-b72e-1111b20ef5c3`;
- turn `01a08280-3abd-7b83-b353-d73cfe08c2ff`;
- Runtime session `ses_a0db0e7aa8884dc7870fb32150e9999f`;
- bootstrap `boot_8aef7dd984f44dd9bacd8209385a8f42`;
- page `page_01`;
- observation `bobs_858e8505392a4faba47bbba9f1c48d85`;
- navigation `nav_a907e5bb52c54fefb17708cd728698cb`.

The task used `rove/session.start` and `rove/browser.inspect`, then stopped at
what it reported as the first failure: the inspection recorded two Google
Analytics requests ending in `net::ERR_ABORTED`. The main IRS request itself
returned HTTP 200, the page policy was `ready`, and the visible page showed
**About Form W-4, Employee's Withholding Certificate** plus **Form W-4 PDF**
under **Current revision**. The task treated the incidental request failures as
terminal before invoking `browser.resolve_target`, so this run did not exercise
the accepted target-name correction.

Per the explicit first-failure rule, no follow-up or retry was sent. PDF
navigation, Back/Forward, multi-tab behavior, PDF scrolling, viewer inspection,
and download interaction were not attempted. Download click count is zero;
consequence key `irs-fw4-pdf-download-20260908-2028` remains unused; no managed
PDF artifact, action receipt, receipt observation/evidence pair, or task-browser
screenshot exists. The task surfaced two aggregate observations and three
aggregate evidence items at the stop, but it did not expose their remaining
individual IDs or a browser ID. Those identifiers are recorded as unavailable
rather than inferred.

The stopped native product screenshot is
[`artifacts/p5.9-live-acceptance/gate-irs-pdf-retry2-stop-analytics-aborted.png`](artifacts/p5.9-live-acceptance/gate-irs-pdf-retry2-stop-analytics-aborted.png)
(532,341 bytes; SHA-256
`4943919215c33cf8ca559875069f92718ffa9c29653b8e2adff69d3e37599c87`).
This is product-surface evidence, not the requested task-browser screenshot.

Normal **Finish** converged under operation
`intent_43416583-8c27-4033-87db-1cfd4b1de1b5`; normal **Archive** then
removed the remaining action. Final product truth showed lifecycle `closed`,
Runtime `completed`, controller `null`, attachment `missing`, profile ownership
`released`, no recovery warnings, no product error, and historical **Controller:
None** with zero current observations/evidence. The cleaned native screenshot is
[`artifacts/p5.9-live-acceptance/gate-irs-pdf-retry2-analytics-aborted-cleaned.png`](artifacts/p5.9-live-acceptance/gate-irs-pdf-retry2-analytics-aborted-cleaned.png)
(384,417 bytes; SHA-256
`8e994dd6c843c90c3c228c7bf53badbca361137a030fdecb80ccfcd944cf9346`).
Runtime PID 23173 was absent after close, and a post-close process audit found no
matching native harness, source-built Rove Desktop, or Runtime process.

The semantic native harness operated only the Rove Electron renderer; the
delegated task was the sole operator of its managed browser and used only the
Rove custom MCP. No CUA, Computer Use, coordinates, direct Playwright/DevTools
access to the managed browser, LocalProductApi bypass, shell HTTP, site API,
external connector, package, staging, commit, or publication was used. This
fresh external gate remains stopped and unaccepted pending Master review.

## Post-stop failure-interpretation correction (local only)

Review of the latest fresh stop confirmed that the low-level evidence was
truthful but the launched task interpreted it too broadly. The two recorded
request failures were non-main-frame diagnostic traffic. The main document had
succeeded, `metadata.pageState.kind` was `ready` with high confidence,
`primaryContentAvailable` was true, and the required visible PDF link remained
present. No Rove tool call failed or rejected, no blocking page-state
proposition was active, and no required target or outcome had yet been tested.

The local correction does not suppress, relabel, or filter browser evidence.
Instead, both thread-start and thread-resume developer instructions now define
a required-path failure narrowly as a failed or rejected Rove tool operation, a
non-ready blocking page-state proposition relevant to the required workflow, a
missing required target or outcome, or an uncertain consequential receipt.
When the main document succeeds and page state is ready, unrelated
non-main-frame or subresource failures are diagnostic unless evidence shows
they prevented a required target or outcome. Authentication, human
verification, access restriction, page failure or instability, tool rejection,
missing required targets/outcomes, and uncertain consequential receipts remain
explicit stop boundaries.

The same concise interpretation is now part of the public `browser.inspect`
tool description for direct MCP clients. It remains general: there are no site
names, URLs, vendor strings, status-code allowlists, evidence suppression, or
broad instructions to ignore errors. Deterministic tests assert the policy is
present unchanged in both `thread/start` and `thread/resume`, and independently
assert the `browser.inspect` catalog wording and retained stop boundaries.

Because the public description changed, the independently pinned 29-tool
canonical in-memory and JSON-wire definition digest is now
`fad7837f081a99800a3c44d9d54f7d1c4eed54dfedf30c640de95a31edb07c5e`.
The established digest checker passed with both calculated forms exactly equal
to that pin. Focused instruction/tool/catalog tests passed 62/62, the P5.0
fixtures passed 75/75, and the full repository suite passed 960/960 across 142
files. Full typecheck, lint, source build, changed-file Prettier, and whitespace
checks passed.

This correction is local only. The external journey was not retried, no managed
browser or site state was changed, and the gate remains stopped and unaccepted
pending independent Master review.

## Fresh external IRS/PDF success after interpretation acceptance

After Master independently accepted the failure-interpretation correction,
one fresh source-built local task retried the external IRS/PDF journey. The
native surface used `canonical_os_home`, App Server 0.153.4, the logged-in
ChatGPT `plus` account, Agent mode, `gpt-6-astra` at `low` effort,
`auto_review`, and persistent Chrome workspace **Rove Live Acceptance
20260908-1619** (`wrk_0d22b405-5c2a-431e-929e-29b8822e2e35`). Its managed
Runtime PID was 62118.

The exact product task identity was:

- product task `task_3f9f9c16-777f-4dc0-b130-f0fbb28221a7`;
- Codex thread `01a0828b-b712-74b1-9a21-6c8acc6c740f`;
- turn `01a0828b-c5fc-74f2-9d04-25b467c32643`;
- Runtime session `ses_8f4ada8e667d430487f8b149d3e3ab6d`;
- PDF and second tab `page_01` and `page_02`;
- download target `page_01`, revision 4, canonical target `t14`; and
- consequence key `irs-fw4-download-20260908-retry3`.

The bootstrap and browser identifiers were not exposed by the final task
surface or final task report and are recorded as unavailable rather than
inferred.

The delegated task verified the official IRS **About Form W-4** page and used
its visible current-revision link to open and verify the 2026 five-page Form
W-4 PDF. It exercised Back and Forward, opened and verified a second tab,
returned to the PDF tab, and scrolled the PDF. The final browser viewport was
the active PDF tab at 100%, showing the lower portion of page 1 and the
beginning of page 2.

After a fresh inspection, the task invoked the Chromium PDF viewer's exact
**Download** control exactly once through `browser.interact`, with
`expectedEffects [{kind: "download_completed", filename: "fw4.pdf"}]`,
`consequential: true`, `effect: "external_commit"`, and the fresh consequence
key above. The result was applied and created exactly one new managed artifact:
`fw4.pdf`, 208,845 bytes, with a verified PDF signature. No retry or duplicate
download occurred.

The durable result identifiers were:

- applied receipt `rcpt_7d7ed89fc2564cc0b6bdbc02c780ba67`;
- download observation `obs_dbd68adddff1427cbf92570b73bca63b`;
- PDF evidence `ev_d18438a14f164bd69ca21e78c4cadc59`;
- final browser observation `bobs_a9c75caa30f2441bbe663e658dcbced2`; and
- final task-browser viewport screenshot evidence
  `ev_547213f1959149e1b1524daf4f531619`.

At task success, product truth contained 13 observations and 14 evidence
items. The visible operation sequence was `session.start`, `browser.inspect`,
`browser.resolve_target`, source-link `browser.interact`, `browser.inspect`,
`browser.screenshot`, `browser.back`, `browser.inspect`, `browser.forward`,
`browser.inspect`, `browser.open_page`, `browser.inspect`,
`browser.switch_page`, `browser.scroll`, `browser.inspect`, `evidence.list`,
`browser.screenshot`, download `browser.interact`, `evidence.list`, and final
`browser.screenshot`. No required-path failure or consequential uncertainty
occurred.

The stopped-success native product screenshot is
[`artifacts/p5.9-live-acceptance/gate-irs-pdf-retry3-success.png`](artifacts/p5.9-live-acceptance/gate-irs-pdf-retry3-success.png)
(486,859 bytes; SHA-256
`e93404a62650852285dfbb7606beb5ce5be0335ba2c5b41dd07925574abc699a`).
This is native product-surface evidence; the task-browser viewport is the
managed evidence item identified above.

Normal **Finish** converged under operation
`intent_e17316e2-4e40-43d7-bdff-c702a5605ff1`; normal **Archive** was then
invoked exactly once. Final product truth showed lifecycle `closed`, Runtime
`completed`, controller `null`, attachment `missing`, profile ownership
`released`, no recovery warnings, and no product error. The cleaned native
screenshot is
[`artifacts/p5.9-live-acceptance/gate-irs-pdf-retry3-success-cleaned.png`](artifacts/p5.9-live-acceptance/gate-irs-pdf-retry3-success-cleaned.png)
(488,022 bytes; SHA-256
`09d6b07ec7c5401e1d9a012934b5c93fd485b5adb9856f1530c1727d54a40eb0`).
Runtime PID 62118 was absent after close, and a post-close process audit found
no matching native harness, source-built Rove Desktop, or Runtime process.

Channel separation remained intact: the semantic native harness controlled
only the Rove Electron renderer, while the product-launched task was the sole
operator of its managed browser through the Rove custom MCP. No CUA, Computer
Use, coordinates, direct Playwright/DevTools access to the managed browser,
LocalProductApi bypass, shell HTTP, site API, connected app, external
connector, package, staging, commit, or publication was used. The external
journey passes locally, but acceptance of P5.9 and Phase 5 remains exclusively
with Master review.

Master subsequently accepted this fresh IRS/PDF journey after independently
verifying the single managed `fw4.pdf` artifact, its `%PDF-1.7` signature and
SHA-256 digest, the applied receipt correlation, the visible task-browser
screenshot, archived task truth, and absence of residual processes.

## Gmail to Calendar authentication stop and post-login retry

One fresh source-built task launched in Agent mode with `gpt-6-astra` at `low`
effort, `auto_review`, and the same persistent Chrome workspace. Desktop PID
66672 and managed Runtime PID 66701 hosted the attempt. Its identity was:

- product task `task_276a7873-4519-4121-bbd4-e5b20462b7ce`;
- Codex thread `01a08295-5b0a-7011-a737-c88ff5822ab3`;
- turn `01a08295-6e96-7f33-9d7a-9098cf3ea752`; and
- Runtime session `ses_2dcbcd80cc4749628e50abb861876cb4`.

Gmail required human authentication. The task stopped at that real boundary
after `session.start`, without entering credentials, reading the requested
email, opening Calendar, using either consequential key, creating or editing
an event, or capturing a task-browser screenshot. At the stop, product truth
showed three observations, 17 evidence items, lifecycle
`waiting_for_human`, controller `null`, and the exact handoff reason **The page
requires authentication that must be completed by a human.** Individual page,
browser, bootstrap, observation, and evidence identifiers were not exposed by
the task report or final native surface and are recorded as unavailable rather
than inferred.

The stop screenshot is
[`artifacts/p5.9-live-acceptance/gate-gmail-calendar-stop-auth.png`](artifacts/p5.9-live-acceptance/gate-gmail-calendar-stop-auth.png)
(463,827 bytes; SHA-256
`5142a5284d267e6e702ce342fd30161170f5b8cfda50d3663a7eb89f648c7aa9`).
Normal **Finish** converged under
`intent_8b1d25ff-6fda-4378-8f37-0f2e941ab500`; **Archive** was invoked once.
The cleaned screenshot is
[`artifacts/p5.9-live-acceptance/gate-gmail-calendar-stop-auth-cleaned.png`](artifacts/p5.9-live-acceptance/gate-gmail-calendar-stop-auth-cleaned.png)
(373,350 bytes; SHA-256
`333dda4a20803aa65457428536dffc3893dac8b186be0d30bcf68c945cd864a6`).
Desktop PID 66672 and Runtime PID 66701 were absent after normal harness close,
and the residual-process audit was clean.

After the user explicitly confirmed login, exactly one new task retried the
same ordinary outcome rather than resuming or replaying the closed task. A new
source-built launch used Desktop PID 91626 and Runtime PID 91656. The retry
identity was:

- product task `task_a3e97eea-5436-46c0-928a-b87d3b35e8f6`;
- Codex thread `01a08297-8bab-7810-b3e8-0687a4b31531`;
- turn `01a08297-9b47-7e70-b0f0-177c95799078`; and
- Runtime session `ses_7f26f07266004242bc46c1a002e67fc5`.

The retry passed authentication and the Gmail inspection visibly exposed the
planning email. From that visible state the task extracted a request for a
30-minute Rove acceptance review tomorrow afternoon with the note **Created
during Rove live acceptance**. It then resolved the email target, but the
required attempt to open it was rejected with `OBSERVATION_STALE`. The task
correctly treated that Rove tool rejection as a stop boundary. Its visible
operation sequence ended at `session.start`, `browser.inspect`, and
`browser.resolve_target`; product truth contained two observations and nine
evidence items. No Calendar page was opened, neither event creation nor title
edit occurred, neither consequential key was used, and no task-browser
screenshot was captured.

The retry stop screenshot is
[`artifacts/p5.9-live-acceptance/gate-gmail-calendar-retry-stop-observation-stale.png`](artifacts/p5.9-live-acceptance/gate-gmail-calendar-retry-stop-observation-stale.png)
(493,754 bytes; SHA-256
`caa2b6a09eac21586505405184b1240a6778eba74ebd528298bada4f54055f5d`).
Normal **Finish** converged under
`intent_51e6d7de-aea0-4b14-9da1-649013ad6e90`; normal **Archive** was invoked
once. The user's subsequent handover-only override arrived after this task had
already stopped, so it did not interrupt an in-flight Calendar mutation. The
task is recorded as safely stopped and then superseded for further live work,
not as having changed external Calendar state.

## User-requested visible handover-only check

The handover-only task uses the still-open second source-built launch and the
same named persistent workspace. Its identity is:

- product task `task_9034a9bc-e825-4515-93c2-76e1b4bea3e7`;
- Codex thread `01a08299-6d3c-7cd1-9c4c-4d116b1bd23b`;
- active turn `01a08299-7897-7360-8343-4dc1828a9318`;
- Runtime session `ses_0eb996d30cb64adba5bcfbc8be24c376`; and
- handoff `handoff_3d82110509bf41b0b2aeb1b6ff378923`, attention request
  `control:ses_0eb996d30cb64adba5bcfbc8be24c376:handoff_3d82110509bf41b0b2aeb1b6ff378923`.

The task verified `https://example.com` as HTTP 200 with visible **Example
Domain**, then used the normal `control.request_human` path with exact reason
**Quick handover visibility test** and entered `control.wait`. No navigation
elsewhere and no external mutation occurred. Product truth records controller
`human`, the exact handoff reason, four observations, and one evidence item.
The individual page, browser, bootstrap, observation, and evidence identifiers
were not exposed by the native surface and are not inferred.

The first native view showed the handoff card as pending with **Take Over**:
[`artifacts/p5.9-live-acceptance/gate-quick-handover-pending-visible.png`](artifacts/p5.9-live-acceptance/gate-quick-handover-pending-visible.png)
(336,829 bytes; SHA-256
`f9355bfcbab312400005724fe59e96d48b673b95662e40b2cbe96c4488fd3487`).
After the normal state projection refreshed, the native surface visibly showed
**You're handling this step** and **Controller: You**, while durable session
truth continued to identify controller `human` and retained the exact reason.

That refreshed state also exposed a reproducible continuity defect. The
lifecycle became `cleanup_required` with **Lifecycle truth was rejected: Open
pending continuation lacks matching Runtime handoff truth.** The handoff card
still reported `Status: pending`, omitted the exact reason from the card body,
and offered neither **Return Control** nor another valid normal continuation;
only **Retry cleanup** remained. The human-owned defect screenshot is
[`artifacts/p5.9-live-acceptance/gate-quick-handover-human-owned-continuity-defect.png`](artifacts/p5.9-live-acceptance/gate-quick-handover-human-owned-continuity-defect.png)
(455,748 bytes; SHA-256
`607e04f0eaac2c0d43f11ee7988f7477e51c61c40d633678a8d36d1b34218b0d`).

After preserving the defect evidence, the task was subsequently closed through
the inspected product-owned **Retry cleanup** path. That path invoked normal
task stop/close convergence: it interrupted the active turn, cancelled the
pending continuation and attention, ended the Runtime session, and confirmed
browser attachment and profile ownership release. The accepted finish
operation was `intent_acd3e12c-371a-44b5-a5a6-cb268b7fcaa6`. A later process
audit confirmed Desktop PID 91626 and Runtime PID 91656 were absent; the only
matching processes were the audit command itself. The task was then archived.

The semantic harness operated only the Rove renderer by roles and labels, and
the product-launched task alone operated its managed browser through Rove. No
CUA, Computer Use, coordinates, direct managed-browser Playwright/DevTools,
LocalProductApi bypass, shell HTTP, Google API/connector, package, staging,
commit, or publication was used.

## Handoff continuity correction

The bounded correction separates the durable request-time handoff generation
from the mutable ownership generation. `activeHandoffGeneration` is written
with the exact active handoff ID when control is requested, remains stable when
the human takes ownership and the ownership generation advances, and is
cleared only when the exact handoff returns to the agent. Coordinator lifecycle
truth now projects this stable field directly and never infers it from the
current ownership generation. Historical or contradictory records remain
readable only for bounded cleanup and fail closed at lifecycle validation.

The corrected positive shape is request/handoff generation N, active human
ownership generation N+1, the same active handoff ID, the exact pending
continuation and attention, lifecycle `waiting_for_human`, the exact visible
handoff reason, and **Return Control** in both full and expanded surfaces. The
existing return path still requires a matching return event, a newer
observation/fresh inspection, and exactly one continuation dispatch. Focused
coverage also rejects wrong IDs, wrong generations, missing continuation or
attention authority, and stale or repeated return attempts.

### Master relationship-invariant finding

Master's independent re-review found that the first correction validated
`ownershipGeneration` and `handoffGeneration` individually but did not enforce
their legal relationship. An impossible constructed Runtime fact set could
therefore match continuation and attention generation while carrying an
unrelated ownership generation.

The lifecycle validator now admits an active handoff only as
`awaiting_human`/controller `null` with ownership generation N and handoff
generation N, or as `active`/controller `human` with ownership generation N+1
and handoff generation N. An active handoff requires both positive generation
fields. Every other active-handoff status, controller, missing generation, or
generation relationship fails closed before Return Control becomes
actionable. Voluntary human ownership without an active handoff remains valid
and non-actionable, while post-return agent truth continues to rely on the
exact last-returned handoff ID and newer observation proof. Legacy stored
sessions that carry an active handoff ID without a readable stable generation
remain schema-readable for recovery, but their native projection fails closed
to `cleanup_required` and cannot expose Return Control. This rejection-only
tightening does not change the previously verified live positive path, so no
external journey was rerun.

### Source-built local recheck

A fresh source-built local task then exercised the corrected lifecycle through
only the normal rendered controls. Its identities were product task
`task_c925b934-19b7-454a-beda-13e4ecb0a352`, Codex thread
`01a082b2-89ad-72b3-8e8b-d62a90775bc1`, and Runtime session
`ses_0da6aa1888cc4ba4b2d3142ed0c3c010`. Desktop PID 85009 and managed Runtime
PID 85043 hosted the run.

The task verified `https://example.com`, requested human control, and entered
`control.wait`. After **Take Over**, the full native surface visibly remained
in `waiting_for_human` with **You're handling this step**, the exact Runtime
handoff reason **Corrected handoff continuity check.**, controller **You**, the
pending handoff, and both **Return Control** actions. It showed four
observations and one evidence item, with no **Retry cleanup** action. The
human-owned screenshot is
[`artifacts/p5.9-live-acceptance/gate-corrected-handoff-human-owned.png`](artifacts/p5.9-live-acceptance/gate-corrected-handoff-human-owned.png)
(447,227 bytes; SHA-256
`56eec4296c9ebdb11679909f6ae9170150902d51047db8827c86351ac38e6145`).

One normal **Return Control** produced one host-authored continuation, one
fresh `browser.inspect`, and the visible confirmation that control returned;
the settled surface showed lifecycle `ready`, controller `agent`, five
observations, and the same single evidence item. Normal **Finish** converged,
normal **Archive** was invoked once, and the harness closed. The final process
audit confirmed PIDs 85009 and 85043 were absent; only the audit command itself
matched. No external state was changed.

### Final verification

- Focused Runtime, coordinator, lifecycle, and full/compact renderer coverage:
  92/92 tests passed in the six-file focused run; the later four-file post-fix
  rerun passed 75/75; the relationship-invariant six-file rerun passed 88/88.
- P5.9 L0 lifecycle oracle: 56,243 assertions passed, including 34 rejection
  cases.
- P5.0 deterministic fixtures: 75/75 passed; installed App Server schema and
  runtime-validator evidence matched Codex 0.153.4.
- Full repository suite: 142 files, 962/962 tests passed.
- Repository typecheck, lint, source build, changed-file Prettier check, and
  `git diff --check` passed.
- The whole-tree Prettier check still reports 109 pre-existing formatting
  violations outside this correction; none were rewritten as part of this
  bounded change.
- No package, installer, staging, commit, or Git publication command was run.

## Gmail to Calendar live retry: saved outcome, screenshot stop

One fresh source-built Desktop retried the Gmail-to-Calendar gate in Agent
mode with `gpt-6-astra` at `low` effort, `auto_review`, and persistent workspace
`wrk_0d22b405-5c2a-431e-929e-29b8822e2e35` (**Rove Live Acceptance
20260908-1619**). Desktop PID 31130 and managed Runtime PID 31160 hosted the
run. Its durable identity was:

- product task `task_474b097b-0e49-4d98-bffa-3c80d65e0cf3`;
- Codex thread/session `01a082d1-4284-7bc0-a166-16ac70e774a3`;
- originating turn `01a082d1-4fb8-7450-b448-fdc32115749a`;
- permitted retry turn `01a082d2-33c6-7d43-b7c1-d7853ac6b0c8`;
- Runtime session `ses_7ac5911507874f33bbcb6879c6ed2968`; and
- bootstrap `boot_bdae33419bb34b81877518bb411d210c`.

The initial Gmail inspection exposed the requested planning-email preview and
its scheduling facts: 30 minutes tomorrow afternoon, title **Rove acceptance
review**, and description **Created during Rove live acceptance.** Resolving
the email produced `OBSERVATION_STALE` for observation
`bobs_73a6f959c5c14efe900be3df75a3394e` before dispatch (mutation version 18
had advanced to 23). The same task therefore used the one explicitly permitted
fresh inspection and target-resolution retry. It opened the email successfully
and confirmed that no fixed start time or timezone was present.

Rove opened Calendar as `page_02` while Gmail remained `page_01`. Calendar's
visible day view identified September 9, 2026 and `GMT+01`. A fresh
reconciliation found no event on the target day, so the task chose the valid
afternoon slot 2:00–2:30 PM and created exactly one event with no guests. The
creation used consequence key `rove-review-create-2026-09-09-1400`. Receipt
`rcpt_2e58b4de1e9b4169867bee7bf113b793` was dispatched and `applied`, from
predecessor `bobs_67aaa9018bc44e699f1452369bf3b80b` to successor
`bobs_19b9c40749844de3b06764dfecf9ef00`; both expected effects, **Event saved**
and **Rove acceptance review**, were observed with no degradation. Fresh
observation `bobs_428da97412a64b05ab55fa4aba11c8c8` then showed exactly one
September 9 event at 2:00–2:30 PM. Reopening it and inspecting as
`bobs_665d1e05cf8846d0af0405d2af0e238a` exposed the same time, the exact
description, and only the organizer rather than any guest.

The title edit used the separate consequence key
`rove-review-rename-2026-09-09-1400`. Receipt
`rcpt_a07a1fef0d86463b8cd3c592e6d79e9b` was dispatched and `applied`, from
predecessor `bobs_0aad5c62db1f424da37ea56ce5f6577a` to successor
`bobs_030fcbbae0e74326914d78c3453ff8b1`; both expected effects, **Event saved**
and **Rove live acceptance review**, were observed with no degradation. Fresh
observation `bobs_adaef2b99c754f479b47bf2dab8b7fc5` showed exactly one event in
Wednesday's day column, visibly as a blue 2:00 PM event bar with the final
title.

The gate stopped at the last screenshot step. After reopening the final event,
the required fresh `browser.inspect` returned `PAGE_CHANGED`; the task did not
retry that browser action and did not call `browser.screenshot`. The Calendar
viewport screenshot is therefore unavailable, even though both external
commits and their fresh semantic verification completed. The saved final event
was left in place, and no guest, email, share, duplicate, or deletion action
occurred. No human attention, handoff, or continuation was created.

The native stop-state screenshot is
[`artifacts/p5.9-live-acceptance/gate-gmail-calendar-retry2-stop-page-changed.png`](artifacts/p5.9-live-acceptance/gate-gmail-calendar-retry2-stop-page-changed.png)
(400,942 bytes; SHA-256
`f2501a943281d6e7971c52959b1733dc44f4cfdcf1d59488df01a81634737c13`).
Visual inspection confirms that it shows the source-built Rove conversation
and permitted retry record; it is not presented as the missing Calendar
viewport evidence. Normal **Finish** converged under
`intent_2cf66987-9d5f-46cb-b711-95e0a9fcad53`, producing terminal observation
`obs_a651010d9fc847a089dba585b6f28cd6` at sequence 20, and normal **Archive**
was invoked once. The archived-state screenshot is
[`artifacts/p5.9-live-acceptance/gate-gmail-calendar-retry2-page-changed-cleaned.png`](artifacts/p5.9-live-acceptance/gate-gmail-calendar-retry2-page-changed-cleaned.png)
(258,806 bytes; SHA-256
`b1d5701f25be05b486748c603bdf230a86bab69e88f20ba1f015d3759dcab00c`).
Persisted truth reports `turnStatus: completed`, `archived: true`, and Runtime
status `completed`; PIDs 31130 and 31160 were absent after the harness closed.

Channel separation remained intact: the semantic native harness controlled
only the Rove Electron renderer while the delegated Codex task was the sole
operator of its managed browser through Rove MCP. No Computer Use, coordinates,
direct Playwright/DevTools access to the managed browser, Google API, connector,
shell HTTP, LocalProductApi bypass, packaging, staging, commit, or publication
was used. Because the required Calendar viewport screenshot is missing, this
run is recorded for Master review as a safely stopped partial gate, not as a
self-accepted pass.

## Gmail to Calendar read-only evidence retry: repeated stale stop

A separate fresh source-built Desktop performed only the Master-delegated
read-only evidence follow-up. Its scope was to verify the already-saved event,
return to the September 9 day view, and capture the missing Calendar viewport;
creating, editing, inviting, sharing, or deleting was expressly prohibited.
Desktop PID 32014 and managed Runtime PID 32044 hosted the run. Its durable
identity was:

- product task `task_dab27dc4-86ee-4930-a8b7-cf149cc3c6f4`;
- Codex thread/session `01a082de-034a-7e91-8264-eba492d46aef`;
- originating turn `01a082de-0ec6-7503-b614-b3540f1c2965`;
- permitted retry turn `01a082df-9852-7fd1-bd77-f62c16e7e011`;
- Runtime session `ses_e418650406584564b31761e2ef709a2a`; and
- bootstrap `boot_6a07faa541b340b2bb0bd326d31c9ecd`.

Fresh Calendar observation `bobs_39fa4c7499f94286ac662dda3477cdd0`
showed the September 9, 2026 day view in visible timezone `GMT+01`, containing
exactly one event titled **Rove live acceptance review** at 2:00–2:30 PM. The
task then resolved that event and attempted only a reversible UI click to
inspect its details. Before dispatch, the browser rejected observation
`bobs_920f3c0041aa4c61b5bf71f3bb2ced21` as `OBSERVATION_STALE`: revision 2,
URL, and viewport were unchanged, but mutation version 13 had advanced to 14.

The same task used the one explicitly permitted follow-up. It performed a
fresh inspection and retried the same reversible click against observation
`bobs_892b2c84c5ed4148a5753c17fe695105`. That retry was also rejected before
dispatch as `OBSERVATION_STALE`: revision 2, URL, and viewport again remained
unchanged while mutation version 14 advanced to 15. The repeated autonomous
mutation-version churn is therefore a reproducible product blocker for this
evidence path. No browser action was dispatched after either rejection, and no
external state changed.

The day-view inspection verifies only the unique event count, final title,
2:00–2:30 PM placement, date, and visible timezone. This follow-up could not
reopen the event, so it did not independently reverify the description or
absence of guests. It also did not reach `browser.screenshot`; the required
actual Calendar viewport screenshot remains unavailable.

The native stop-state screenshot is
[`artifacts/p5.9-live-acceptance/gate-gmail-calendar-evidence-retry-stop-observation-stale.png`](artifacts/p5.9-live-acceptance/gate-gmail-calendar-evidence-retry-stop-observation-stale.png)
(431,296 bytes; SHA-256
`7d1803edadd7533f32833d22db4225eeed494fd2572f5a661d1f85d531876ca3`).
Visual inspection confirms that it shows the source-built Rove conversation,
the repeated stale-observation stop, and the reported day-view facts; it is not
presented as Calendar viewport evidence. Normal **Finish** converged under
`intent_28bfa7da-5fb3-4f6f-8a43-a8127039fa31`, producing terminal observation
`obs_846c96eca2aa41429fa8c312889a22bf` at sequence 3, and normal **Archive**
was invoked once. The archived-state screenshot is
[`artifacts/p5.9-live-acceptance/gate-gmail-calendar-evidence-retry-observation-stale-cleaned.png`](artifacts/p5.9-live-acceptance/gate-gmail-calendar-evidence-retry-observation-stale-cleaned.png)
(296,389 bytes; SHA-256
`dcc1bc4d4da342756daa5c8ec6ccb7d03f2346f40d85262dd817cdfadee30821`).
Persisted truth reports `turnStatus: completed`, `archived: true`, and Runtime
session completion. PIDs 32014 and 32044 were absent after the harness closed.

Channel separation remained intact: the semantic native harness controlled
only the Rove Electron renderer while the delegated Codex task was the sole
operator of its managed browser through Rove MCP. No Computer Use, coordinates,
direct Playwright/DevTools access to the managed browser, Google API, connector,
shell HTTP, LocalProductApi bypass, packaging, staging, commit, or publication
was used. This evidence-only retry is recorded for independent Master review as
a safely stopped blocker, not as a self-accepted pass.

## Dynamic-page freshness correction and Calendar evidence completion

The repeated Calendar stop above was traced to page-global mutation drift
being treated as universal action and screenshot staleness even when the
observed page, document, viewport, and exact target remained valid. The browser
authority path now permits global mutation-version drift only for
target-scoped, non-coordinate actions and observation-bound screenshots. It
revalidates the exact registered target immediately before dispatch using its
frame instance, node identity token, document-or-shadow-root identity token,
semantic identity and state, geometry, viewport/clipping state, and occlusion.
Navigation, page revision, ownership, viewport, scroll, device scale factor,
frame/root/target replacement, target state, ambiguity, occlusion, and all
consequential authorization and reconciliation boundaries remain hard stops.
Coordinate actions and page-scoped mutations remain whole-observation strict.

The deterministic `/dynamic-freshness` fixture continuously mutates an
unrelated marked control while retaining stable main-document, shadow-root,
and iframe targets. Its 16 cases prove one dispatch for a stable target and a
bound viewport screenshot under unrelated churn, plus zero dispatch for
identity, hidden, disabled, occluded, moved, target replacement, root
replacement, frame replacement, navigation, and ambiguity failures. Delayed
screenshot cases preserve navigation, viewport, scroll, and page-closure
boundaries, and coordinate action remains strict. The browser capability atlas
version is `2026-09-08.1`; MCP action and screenshot descriptions and the
protocol tool-catalog digest were updated with the same contract.

Validation after the final correction was:

- dynamic freshness fixture: 16/16 tests passed;
- focused Browser, Runtime, and MCP coverage: 10 files, 185/185 tests passed;
- capability waves: 6 files, 53/53 tests passed after the required
  sandbox-capable browser rerun;
- P5.0 deterministic fixtures: 75/75 tests passed;
- P5.0 App Server schema guard: exact Codex 0.153.4 values passed;
- P5.9 L0 lifecycle oracle: 56,243 assertions passed, including 34 rejection
  cases;
- MCP stdio E2E: 2/2 tests passed against the rebuilt distribution;
- full repository suite: 143 files, 978/978 tests passed; and
- repository typecheck, lint, source build, changed-file Prettier check, and
  `git diff --check` passed.

No package, installer, staging, commit, or publication command was run.

### Read-only Calendar evidence rerun

A freshly built source Runtime reused persistent workspace
`wrk_0d22b405-5c2a-431e-929e-29b8822e2e35` (**Rove Live Acceptance
20260908-1619**) in Agent mode. Its Runtime session was
`ses_0f4cfc6acb4747ffb8b58802eb57f945`, its stable page was `page_01`, and its
Rove browser session was `browser_7ee55781-fba0-4427-9ebb-bda0a7b5bb8f` under
Google Chrome 152.0.7977.76. This rerun was read-only with respect to Calendar:
it created, edited, invited, shared, emailed, or deleted nothing.

The first day-view inspection showed visible timezone `GMT+01`, heading
**Wednesday, September 9, 2026, 1 event**, and exactly one visible enabled,
unoccluded target for **Rove live acceptance review** at 2:00–2:30 PM. Opening
that existing event was a reversible UI action. Receipt
`rcpt_a2b3d734c4da294bc7c1eab30a274` dispatched once but honestly reconciled as
`not_applied` because an over-specific expected time string used different
punctuation from Calendar; the dialog nevertheless opened and the requested
effect was not replayed. Fresh observation
`bobs_159f0c621896471c958c1c8075428881` then independently showed the exact
title, **Wednesday, September 9⋅2:00 – 2:30pm**, description **Created during
Rove live acceptance.**, and only **Organizer: Kamil Adeyinka**. The dialog
exposed no guest list or invited guest identity; **Invite via link** remained
an available action and was not used.

Closing the dialog exercised the corrected dynamic-page path. A deliberately
delayed predecessor first failed safely before dispatch when its exact
observation could no longer be revalidated. The immediately fresh observation
`bobs_7dab60b29c42403aa576a2203aa3fd24` then targeted the same visible enabled
Close control; receipt `rcpt_1b9a7c5a6407438e98a6f498b32a4c83` dispatched
once and reconciled `applied`, with no degradation, to successor
`bobs_1ad6f8b66132427e93362cbe682f1d3b` and revision 4.

Fresh day-view observation `bobs_e32c6766de814a9280b7605172101715`
again proved the exact single event count, title, date, 2:00–2:30 PM range,
visible timezone, and unoccluded target geometry. Its first capture attempt
failed safely because a target style changed during capture. One fresh
read-only capture retry used observation
`bobs_50b3350df25448a3afee9f3fae2d0971` and succeeded as Rove evidence
`ev_3acc50075d4b4e409f512711171a1c88`, bound to `page_01`, revision 4, URL
`https://calendar.google.com/calendar/u/0/r/day/2026/9/9`, and viewport
1200×762 CSS pixels at device scale factor 2. The actual Calendar viewport is
retained as
[`artifacts/p5.9-live-acceptance/gate-gmail-calendar-dynamic-freshness-success.png`](artifacts/p5.9-live-acceptance/gate-gmail-calendar-dynamic-freshness-success.png)
(163,776 bytes; SHA-256
`5a7446db8c5fc577d0474b19cdf792ee4d49cd373bb52d165bc5ad4b60290a83`).
Visual inspection confirms the September 9 day view, `GMT+01`, and exactly one
blue **Rove live acceptance review, 2pm** event bar, with no details dialog or
duplicate event visible.

The Runtime session ended normally with status `completed`, controller
cleared, and ownership generation 1. The source-built Desktop harness was then
terminated; managed Runtime PID 70958 was absent from the final process audit,
and no Rove, Electron, managed Runtime, or workspace-browser process from the
run remained.

The current task environment did not expose a native Rove application surface
to Computer Use, so this evidence-only rerun could not truthfully create,
finish, or archive a fresh native product task. It instead exercised the
freshly built Runtime exclusively through the normal Rove MCP authority path
and completed that Runtime session. This is a provenance limitation, not an
external-state or browser-evidence gap; it is recorded for independent Master
review and is not self-accepted here.

## Native product Calendar evidence rerun after Master re-review

Master's deterministic re-review passed the target-scoped freshness design and
independent focused coverage at 73/73, but correctly rejected the preceding
Runtime-only rerun as insufficient product provenance. One fresh source-built
Rove Desktop therefore ran the same read-only Calendar verification through
the semantic native product harness. The harness used Playwright only to
launch and operate the Rove Electron renderer by accessible roles and labels;
the resulting product task was the sole caller of every managed-browser Rove
tool.

The launch used `canonical_os_home`, Agent mode, `gpt-6-astra` at `low`
effort, `auto_review`, and the user-selected persistent workspace
`wrk_0d22b405-5c2a-431e-929e-29b8822e2e35` (**Rove Live Acceptance
20260908-1619**). Its durable identities were:

- product task `task_83971cde-69da-4513-9a69-45a549adb655`;
- Codex thread `01a082ff-ac01-71d0-9efa-6fceade52719`;
- originating turn `01a082ff-bcc9-7102-ba05-6273c38bfe85`;
- exact-target continuation turn `01a08300-ceb8-7223-b04a-3b6df453baec`;
- screenshot-retry turn `01a08302-3b41-7e03-8270-3e583ecf2138`;
- Runtime session `ses_0e8205037e5c4395b7fab084a18554e7`;
- browser session `browser_f0a0bbfc-95a4-4fda-93fb-93b634684019`;
- bootstrap `boot_2ac5cd9e35ce483c875d3984547e24df`;
- page `page_01`; and
- navigation `nav_076c939d2027469282ab66473c813983`.

Initial observation `bobs_c57eff75b8784a4393d46552eef7077f`
verified the September 9, 2026 Day view, visible timezone `GMT+01`, and exactly
one **Rove live acceptance review** event at 2:00–2:30 PM. The first target
resolver request returned `ambiguous` with `insufficient_separation`; it was a
read-only grounding result and dispatched nothing. Because this gate had no
first-failure stop rule, the same product task continued from a fresh
inspection and used the exact canonical target reference `t74` rather than
replaying the ambiguous query.

Fresh event observation `bobs_daa2eb8664cf401bacbc155763141dba`
grounded that exact visible event. Open receipt
`rcpt_60ef7bb8d99e44b6a797998a1e42a19e` dispatched once and reconciled
`applied`, non-consequential, to successor
`bobs_edf91666cb234b1c910187decb4dd97b`. Details observation
`bobs_18cd04a590d24d00b2ac3ffa426a4d1b` then verified the exact title,
September 9 date, 2:00–2:30 PM time, description **Created during Rove live
acceptance.**, and no guest identity or guest list—only organizer Kamil
Adeyinka. Close target `t82` was freshly grounded; receipt
`rcpt_7ab9d18e6cc94a738c74b83ab4c04f60` dispatched once and reconciled
`applied`, non-consequential, to successor
`bobs_118528c2ccea40d7bb0ba2b03db2642e`. Final Day observation
`bobs_e710f5421482443182ed1b6ff6328f84` reconfirmed the exact single event
with no dialog open.

The first observation-bound viewport capture failed safely before producing
evidence because a target style changed during capture. The same task used one
bounded read-only retry only: fresh observation
`bobs_00dc97d0a48b474da8ffcc75526c3664` reconfirmed the exact Day view and
`rove/browser.screenshot` produced evidence
`ev_fd39c8caeaa04b58855973cd04214f82`. The evidence is bound to `page_01`,
revision 4, URL
`https://calendar.google.com/calendar/u/0/r/day/2026/9/9`, and a 1200×762 CSS
pixel viewport at device scale factor 2. The retained artifact is
[`artifacts/p5.9-live-acceptance/gate-gmail-calendar-native-dynamic-freshness-success.png`](artifacts/p5.9-live-acceptance/gate-gmail-calendar-native-dynamic-freshness-success.png)
(163,776 bytes; SHA-256
`5a7446db8c5fc577d0474b19cdf792ee4d49cd373bb52d165bc5ad4b60290a83`).
Independent visual inspection confirms September 9, 2026 Day view, `GMT+01`,
one blue **Rove live acceptance review, 2pm** event bar, and no open details
dialog or duplicate event.

The session also retained bounded diagnostic evidence
`ev_ac04ac0050a748f187c5dd49cb49f7c3` for the successful main-frame HTTP 200
navigation, `ev_77aa4c22a00f47de9fc25f2c1fee1c79` for one redacted Calendar console
diagnostic, and `ev_848c1f8eeda8476ba8316a8ff666a72d` for a non-main-frame
`ERR_BLOCKED_BY_ORB` request diagnostic. None represented a failed Rove tool,
blocking page state, or failure of the required read-only path.

Normal **Finish** converged under operation
`intent_880407ba-54c3-43ce-b8d6-973f78b8275b`, and normal **Archive** was
invoked once. Persisted product truth then showed conversation
`turnStatus: completed`, `archived: true`, lifecycle `closed`, Runtime
`completed`, controller `null`, terminal attachment `missing`, profile
ownership `released`, no available actions, no recovery warnings, and no
product error. Desktop PID 83838 and Runtime PID 83902 were absent after the
harness closed; the run-owned process audit also found no matching native
harness, Rove Electron, managed Runtime, or workspace-browser process.

Calendar remained strictly read-only throughout: no create, edit, invite,
share, email, delete, or other external mutation occurred. No Computer Use,
coordinates, direct task-browser Playwright/DevTools, Google API or connector,
shell HTTP, LocalProductApi bypass, package, staging, commit, publication, or
Drive action was used. This source-product evidence supersedes the preceding
provenance limitation and is returned for independent Master acceptance; it is
not self-accepted here.

## Google Drive upload journey: product file-grant stop

One fresh source-built Rove Desktop started the next full customer-product
Google Drive journey through the semantic native harness. The harness launched
and operated only the Rove Electron renderer by accessible roles and labels;
the product task remained the sole caller of all managed-browser tools. The
launch used `canonical_os_home`, Agent mode, `gpt-6-astra` at `low` effort,
`auto_review`, and user-selected persistent workspace
`wrk_0d22b405-5c2a-431e-929e-29b8822e2e35` (**Rove Live Acceptance
20260908-1619**). Desktop PID 53193 and Runtime PID 53225 hosted the run.

Before launch, the bounded source file `/tmp/rove-live-acceptance.txt` was
verified as 74 bytes with SHA-256
`2c6a032c7575a2b3a80543b9551eea65ad61a9f4bd78a09a3eb05adf125b485b`
and the exact three requested lines. The user-facing outcome submitted to Rove
was exactly the Master-provided Drive outcome; no hidden path authority or
alternate upload instruction was added.

The run identities were:

- product task `task_2e9dfb96-f560-49c9-9869-6da75da8568d`;
- Codex thread `01a08307-f594-7d02-99ce-f2a30769b4fb`;
- turn `01a08308-0479-7870-a488-23b5e83f6a95`;
- Runtime session `ses_2d974e05d3ba4993b0f9e434481d584c`;
- browser session `browser_2aa47beb-4263-4641-875c-efc506e43288`;
- bootstrap `boot_0a457bf261754877a80a51db8deca581`;
- page `page_01`;
- browser navigation `nav_c1f08b8a8cab4c0a80008e5191fbe2c8`;
- lifecycle navigation observation `obs_105b1d99b242477cb8b6d3a33851ba79`;
  and
- browser observation `bobs_6279d4640d6e42e5a0eea27620ac370c`.

The fresh Drive inspection reached `https://drive.google.com/drive/my-drive`
and confirmed that the root listing contained no folder named **Rove Live
Acceptance P5.9 20260908-2250**. The task then stopped before the first
mutation because the requested existing local file could not be turned into an
upload artifact without a human file-picker selection. Browser upload accepts
only opaque session-scoped file-evidence IDs. The existing-file authority path,
`evidence.request_file_grant`, intentionally accepts only a visible reason and
`allowMultiple`; Rove Companion must foreground itself and open the operating
system picker, and selected paths never cross MCP or the control plane. The
semantic native harness can operate only the Electron renderer and therefore
has no authorized role/label surface through which to select
`/tmp/rove-live-acceptance.txt` in that OS dialog.

Using `evidence.create_file` from the supplied text, passing the raw path to
the browser, injecting a picker result, or driving the operating-system picker
would substitute a different authority path and violate this gate. This is a
general product/harness consent boundary, not a one-off Drive target symptom.
Changing it is not mechanically safe or bounded because it would require a
new explicit product-level consent/test authority rather than a site fix, so no
implementation was attempted before Master review.

No root-folder creation, upload, rename, Archive creation, semantic transfer,
destination navigation, download, or screenshot action occurred. Consequently
there are no consequence keys, action receipts, transaction IDs or phases,
destination verification observation, managed download artifact, or Drive
screenshot evidence ID to report. The session retained only seven bounded
navigation/console/request diagnostics:
`ev_b22bd58385bd4881894b6a07f7e51a34`,
`ev_ec6d843c1aeb48d9929120e31ceb7062`,
`ev_f873fbe2a0a1482fb3bc6c06eba95dfa`,
`ev_0a2265b37390487cb1c74768b9637cdb`,
`ev_0644ad159d554919a69e864dd5c6eab9`,
`ev_b349f705e7fa4a99a12ab170ae7d3151`, and
`ev_d7e4e6ce828741ff90d1c883cca62f79`.

Normal **Finish** converged under operation
`intent_dd7cccab-4f75-4de2-8ed1-4acdd7c2c7c2`; normal **Archive** was then
invoked once. Persisted truth showed `turnStatus: completed`, `archived: true`,
lifecycle `closed`, Runtime `completed`, controller `null`, terminal attachment
`missing`, profile ownership `released`, no available actions, no recovery
warnings, and no product error. Session observations
`obs_5ff5262cd48b41698b513e83ebfb4d6d` and
`obs_6553a9a298ec46dda96698e09185e17e` record start and completion. After the
harness closed, the run-owned process audit found neither PIDs 53193/53225 nor
any matching native harness or session process.

No Drive or other external state changed. No share, invite, email, delete,
Computer Use, coordinates, direct task-browser Playwright/DevTools, Google API
or connector, shell HTTP, alternate browser tool, LocalProductApi bypass,
package, staging, commit, or publication was used. This gate is returned as a
safely stopped product-boundary finding for independent Master review and is
not self-accepted.

## Follow-up: task attachment authority implemented

The Drive stop above is now addressed by a product-level task attachment
boundary. Pre-launch composer selection and mid-task
`evidence.request_file_grant` share opaque attachment identities, immutable
private byte snapshots, exact task/Runtime-session binding, safe metadata,
Runtime evidence materialization, durable visible file attention, and terminal
cleanup. Raw prompt paths remain data and grant no authority.

The implementation decision, threat model, operator guidance, complete
automated acceptance record, and pending manual native-picker procedure are in
[`2026-09-08-task-attachment-boundary.md`](./2026-09-08-task-attachment-boundary.md).
The deterministic source-renderer and component harness passed 70/70 checks with an exact
74-byte fixture; the final full repository suite passed 1003/1003. This automated
result is explicitly not the real OS-picker gate. The manual **Attach files** →
native picker release gate remains pending for independent Master review and
has not been self-accepted.

The harness also does not constitute the full signed-in product launch,
managed-browser upload, and terminal cleanup journey; that source-product gate
remains pending.
