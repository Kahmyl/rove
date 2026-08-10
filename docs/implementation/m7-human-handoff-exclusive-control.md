# Rove — Milestone 7 Implementation Runbook

## Human Handoff & Exclusive Browser Control

## Purpose

This document is the authoritative implementation runbook for:

**Milestone 7 — Human Handoff & Exclusive Control**

Execute this plan directly.

Do not redesign the architecture.

Do not perform broad repository exploration.

Do not reconsider decisions specified here.

Do not implement the Electron Companion.

Do not implement Capture Mode human activity observation.

Do not implement automatic login/CAPTCHA/MFA detection.

At the end of this milestone, this flow must work:

```text
Agent controls browser
        ↓
control.request_human
        ↓
controller = null
status = awaiting_human
        ↓
agent mutation blocked
        ↓
human explicitly takes control
        ↓
controller = human
status = active
        ↓
agent mutation still blocked
        ↓
human uses visible browser manually
        ↓
human explicitly returns control
        ↓
targets invalidated
page revision increments
        ↓
controller = agent
status = active
        ↓
control.wait wakes agent
        ↓
agent re-inspects
        ↓
agent continues
```

The most important invariant is:

> There is never more than one browser controller, and an MCP agent cannot impersonate the human controller.

---

# 1. Preconditions

Milestones 1–6 must already provide:

```text
real Playwright browser
semantic inspection
TargetReference
target invalidation
browser actions
runtime sessions
filesystem persistence
observations
BrowserCommandCoordinator
ControlService
private runtime HTTP API
MCP stdio
MCP Streamable HTTP
MCP bearer authentication
```

Do not reimplement any of these.

---

# 2. Architecture Boundary

Control remains a runtime domain concern.

```text
MCP Agent
   │
   │ control.request_human
   │ control.status
   │ control.wait
   ▼
MCP Adapter
   │
   ▼
Rove Runtime  ← authoritative control state
   ▲
   │
Private Runtime API
   ▲
   │
Human / future Electron Companion
```

MCP does not own control.

Electron does not own control.

Browser package does not own control.

Only the Rove runtime owns control state.

---

# 3. Controller Model

Keep the existing controller model:

```ts
type Controller =
  | "agent"
  | "human"
  | null;
```

Interpretation:

```text
agent
    external MCP agent may mutate browser

human
    human may mutate browser

null
    nobody may mutate browser
```

`null` is deliberately used during the handoff-request state.

---

# 4. Session Status During Control

Use existing session states.

Normal agent control:

```text
status = active
controller = agent
```

Agent requests human:

```text
status = awaiting_human
controller = null
```

Human accepts:

```text
status = active
controller = human
```

Human returns:

```text
status = active
controller = agent
```

Do not add another session status such as:

```text
human_control
handoff
waiting
```

The existing model is sufficient.

---

# 5. Persisted Handoff State

Add an optional handoff field to the session.

Protocol:

```ts
interface HumanHandoff {
  reason: string;
  requestedAt: string;
}
```

Session:

```ts
interface Session {
  // existing fields...

  handoff?: HumanHandoff;
}
```

Purpose:

The future Electron Companion must be able to query:

```text
Why does the agent need me?
```

without depending on an in-memory object or searching observations.

---

# 6. Handoff Lifecycle

When agent requests human:

```ts
session.handoff = {
  reason,
  requestedAt
};
```

While:

```text
status = awaiting_human
```

the handoff remains present.

When the human successfully takes control:

```text
session.handoff
```

remains present while human control is active.

This allows future Companion UI to continue displaying the handoff reason.

When human returns control to agent:

```text
handoff = undefined
```

When session completes/fails:

```text
handoff = undefined
```

---

# 7. Do Not Use Generic External Control Transfer

The existing generic concept:

```ts
transferControl({
  actor,
  controller
})
```

is too permissive for the external API.

Do not expose a generic:

```text
set controller = ...
```

operation through MCP or HTTP.

Replace external behavior with explicit domain commands.

Runtime application operations:

```text
getControlStatus
requestHuman
takeHumanControl
returnAgentControl
waitForControl
```

Exact method names should follow repository naming conventions, but the semantics are fixed.

---

# 8. Required Runtime Interface

Extend `RoveRuntime` with:

```ts
getControlStatus(
  sessionId: string
): Promise<ControlStatus>;
```

```ts
requestHuman(
  sessionId: string,
  request: RequestHumanRequest
): Promise<ControlStatus>;
```

```ts
takeHumanControl(
  sessionId: string
): Promise<ControlStatus>;
```

```ts
returnAgentControl(
  sessionId: string
): Promise<ControlStatus>;
```

```ts
waitForControl(
  sessionId: string,
  request?: ControlWaitRequest
): Promise<ControlWaitResult>;
```

The existing generic `transferControl()` may be removed from the public `RoveRuntime` contract once all internal call sites are migrated.

Do not leave two competing public control APIs.

---

# 9. ControlStatus

Add:

```ts
interface ControlStatus {
  sessionId: string;

  status: SessionStatus;

  controller: Controller;

  handoff?: {
    reason: string;
    requestedAt: string;
  };

  updatedAt: string;

  observationSeq?: number;
}
```

Do not use the old minimal `ControlState` as the primary M7 external result if it cannot represent the handoff state.

It may remain internally if useful.

---

# 10. RequestHumanRequest

Schema:

```ts
interface RequestHumanRequest {
  reason: string;
}
```

Validation:

```text
trim whitespace
minimum 1 character
maximum 500 characters
```

Do not allow blank handoff reasons.

---

# 11. ControlWaitRequest

Use:

```ts
interface ControlWaitRequest {
  afterSeq?: number;
  timeoutMs?: number;
}
```

Defaults:

```text
afterSeq = current known sequence / 0 when omitted
timeoutMs = configured controlWaitMs
```

Configured default already exists:

```text
30 seconds
```

Maximum:

```text
60 seconds
```

Clamp/reject larger values.

Do not permit an unbounded wait.

---

# 12. ControlWaitResult

Return:

```ts
interface ControlWaitResult {
  event:
    | "human_requested"
    | "human_took_control"
    | "human_returned_control"
    | "session_completed"
    | "session_failed"
    | "timeout";

  sessionId: string;

  controller: Controller;

  status: SessionStatus;

  observationSeq?: number;

  handoff?: HumanHandoff;
}
```

A timeout is:

```text
successful control.wait response
```

not an error.

---

# 13. Agent Request Human

Implement:

```text
control.request_human
```

Allowed only when:

```text
session.status = active
controller = agent
```

Flow must execute inside:

```text
BrowserCommandCoordinator.execute(sessionId)
```

Sequence:

```text
wait for currently executing browser mutation
        ↓
block future agent mutation by changing session state
        ↓
controller = null
status = awaiting_human
handoff = { reason, requestedAt }
        ↓
persist session
        ↓
append human_requested observation
        ↓
publish control event to waiters
        ↓
return ControlStatus
```

This means a handoff happens at an atomic browser-action boundary.

---

# 14. Request During Running Browser Action

If the agent calls `control.request_human` while another action is running:

Do not abort the running browser action.

The existing per-session coordinator determines ordering.

Flow:

```text
browser action starts
        ↓
request_human queued
        ↓
browser action finishes
        ↓
request_human executes
        ↓
controller becomes null
```

Do not build browser-action cancellation in M7.

---

# 15. Duplicate RequestHuman

If:

```text
status = awaiting_human
controller = null
```

and requestHuman is called again:

Return current ControlStatus successfully.

Do not create duplicate observations.

Do not overwrite the original reason.

Treat the operation as idempotent while already awaiting human.

---

# 16. RequestHuman While Human Controls

If:

```text
controller = human
```

agent `requestHuman` returns:

```text
CONTROL_NOT_OWNED
```

No state change.

---

# 17. RequestHuman in Terminal Session

If session:

```text
completed
failed
```

return:

```text
SESSION_NOT_ACTIVE
```

No state change.

---

# 18. Agent Mutation While Awaiting Human

Once:

```text
controller = null
status = awaiting_human
```

all agent browser mutations must fail with:

```text
CONTROL_NOT_OWNED
```

This includes:

```text
navigate
click
type
press
scroll
back
forward
switch_page
close_page
screenshot capture
```

Do not use:

```text
HUMAN_CONTROL_REQUIRED
```

for ordinary post-handoff mutation attempts.

`CONTROL_NOT_OWNED` accurately describes the state.

---

# 19. Read Operations While Awaiting Human

Allow:

```text
session.status
control.status
control.wait
session.observations
evidence.list
evidence.read
```

Live `browser.inspect` is also allowed while awaiting human.

Reason:

Inspection is non-mutating and helps the external agent understand state.

Do not allow inspection to modify control state.

---

# 20. Human Takes Control

Implement private runtime operation:

```text
takeHumanControl(sessionId)
```

Allowed only when:

```text
status = awaiting_human
controller = null
handoff exists
```

Execute inside the same:

```text
BrowserCommandCoordinator
```

Flow:

```text
verify session
        ↓
controller = human
status = active
handoff remains
        ↓
persist session
        ↓
append human_took_control
        ↓
publish control event
        ↓
return ControlStatus
```

Do not invalidate targets yet.

The important invalidation occurs when control returns to the agent.

---

# 21. Human Takeover Without Agent Request

Milestone 7 must also support voluntary human takeover for future Companion Mode.

Add separate private operation:

```text
takeHumanControl(sessionId)
```

with behavior depending on current state.

## Companion Mode + Agent Currently Controls

Allowed:

```text
mode = companion
status = active
controller = agent
```

Flow executes through coordinator:

```text
wait for current agent action
        ↓
controller = human
status = active
handoff = undefined
        ↓
persist
        ↓
append human_took_control
        ↓
publish event
```

This supports:

```text
Take Control
```

in M8.

## Agent Mode

Voluntary human takeover without an agent request is not allowed in M7.

If:

```text
mode = agent
controller = agent
```

and human attempts takeover:

return:

```text
HUMAN_CONTROL_REQUIRED
```

The human may take over Agent Mode only after:

```text
control.request_human
```

This keeps Agent Mode explicit.

## Capture Mode

Capture Mode already starts:

```text
controller = human
```

Calling take control again returns current status idempotently.

---

# 22. Human Mutation Path

M7 does not expose generic human browser actions through HTTP.

The human uses the visible headed Chrome browser directly.

Playwright remains connected and observes page lifecycle at the browser level.

Do not try to route the human's mouse/keyboard through RuntimeService.

That belongs to the real browser window.

---

# 23. Agent Requests During Human Control

When:

```text
controller = human
```

agent mutation calls continue returning:

```text
CONTROL_NOT_OWNED
```

The browser remains alive.

MCP connection remains alive.

Rove session remains active.

---

# 24. Human Returns Control

Implement:

```text
returnAgentControl(sessionId)
```

Allowed when:

```text
status = active
controller = human
```

Execute through:

```text
BrowserCommandCoordinator
```

Critical ordering:

```text
verify session
        ↓
synchronize current browser page state
        ↓
invalidate target refs
        ↓
revision++
        ↓
controller = agent
handoff = undefined
status = active
        ↓
persist session
        ↓
append human_returned_control
        ↓
publish control event
        ↓
return ControlStatus
```

Target invalidation must occur **before** agent ownership is restored.

This prevents a waiting agent from receiving control and racing an old target action against invalidation.

---

# 25. Target Invalidation Scope

On human → agent handback:

Invalidate all currently registered browser page targets.

Do not invalidate only the active page.

Reason:

During human control the user may have:

```text
changed tabs
opened tabs
closed tabs
navigated inactive tabs
altered page state
```

Add browser-session operation if needed:

```ts
invalidateAllTargets(): Promise<void>;
```

or extend existing browser invalidation implementation internally.

Do not make RuntimeService iterate browser package internals.

---

# 26. Revision Behavior After Human Return

For every still-open registered page:

```text
revision++
```

exactly once during handback invalidation.

Old TargetReferences from every page must fail.

Expected:

```text
inspect page_01 at revision 5
inspect page_02 at revision 3

human control

return control

page_01 revision 6
page_02 revision 4
```

New inspection creates fresh refs.

---

# 27. Active Page Synchronization

Before restoring agent control:

ask BrowserSession for current:

```text
pages()
```

Determine active page according to browser package state.

Update:

```text
session.activePageId
```

before persisting agent ownership.

If human opened/switched pages manually and browser package page lifecycle listeners already update active-page state, use that.

Do not use stale pre-handoff `activePageId`.

---

# 28. Human-Closes-Page Handling

If the human closes a page manually:

the existing browser PageRegistry must observe closure.

If human closes the active page:

browser package should follow its existing page lifecycle policy and ensure another valid active page exists where applicable.

M7 must not create a second page lifecycle mechanism.

---

# 29. Human Closes Entire Browser

If the human manually closes the entire Chrome/browser process:

BrowserSession should surface:

```text
BROWSER_CLOSED
```

On returnAgentControl:

mark session:

```text
status = failed
controller = null
handoff = undefined
endedAt = now
```

Append:

```text
session_failed
```

Publish failure to waiters.

Return/throw:

```text
BROWSER_CLOSED
```

Do not restore agent ownership to a dead browser.

---

# 30. ReturnAgentControl Idempotency

If:

```text
controller = agent
status = active
```

and no handoff exists:

return current ControlStatus successfully.

Do not invalidate again.

Do not append duplicate human-returned event.

This protects against UI double-click/retry.

---

# 31. TakeHumanControl Idempotency

If:

```text
controller = human
```

return current status.

Do not append duplicate event.

---

# 32. Control Observations

Use exactly these observation names:

```text
human_requested
human_took_control
human_returned_control
```

Do not use parallel variants such as:

```text
control_transferred
control_returned
takeover
handoff_started
```

Migrate old generic observation names if they are still present in M7 code paths.

---

# 33. human_requested Observation

Store:

```ts
{
  actor: "agent",
  type: "human_requested",
  data: {
    reason
  }
}
```

Reason is intentionally persisted.

It is not secret input.

---

# 34. human_took_control Observation

Requested handoff:

```ts
{
  actor: "human",
  type: "human_took_control",
  data: {
    requested: true
  }
}
```

Voluntary Companion takeover:

```ts
{
  actor: "human",
  type: "human_took_control",
  data: {
    requested: false
  }
}
```

No extra prose.

---

# 35. human_returned_control Observation

Store:

```ts
{
  actor: "human",
  type: "human_returned_control",
  data: {
    activePageId,
    invalidatedPages: number
  }
}
```

Do not persist browser page text.

---

# 36. Control Status Observation Sequence

When a control transition appends an observation:

include that observation's sequence in returned:

```text
ControlStatus.observationSeq
```

This allows an MCP agent to call:

```text
control.wait(afterSeq)
```

without losing events.

Observation append should therefore return the persisted Observation if it does not already.

Modify ObservationService minimally if needed.

---

# 37. control.wait Purpose

`control.wait` is the efficient agent-side handoff synchronization primitive.

Expected agent behavior:

```text
control.request_human
        ↓
receive observationSeq = 41
        ↓
control.wait(afterSeq = 41)
        ↓
blocks
        ↓
human takes control
        ↓
returns human_took_control seq 42

control.wait(afterSeq = 42)
        ↓
blocks
        ↓
human returns
        ↓
returns human_returned_control seq 43
```

This avoids repeated:

```text
control.status
control.status
control.status
```

polling.

---

# 38. Wait Implementation

Implement an in-process:

```text
ControlWaitService
```

or equivalent.

Use:

```text
sessionId → waiter set
```

Do not use filesystem polling.

Do not poll observations on an interval.

---

# 39. Lost-Wakeup-Safe Wait Algorithm

`control.wait` must avoid this race:

```text
check observations
event happens
register listener
→ event missed
```

Use this order:

```text
1. query persisted relevant observations after afterSeq
2. if found → return first relevant result
3. register waiter
4. query persisted relevant observations after afterSeq again
5. if found → unregister waiter + return
6. otherwise await event or timeout
```

This is mandatory.

---

# 40. Relevant Wait Events

Relevant durable observation types:

```text
human_requested
human_took_control
human_returned_control
session_completed
session_failed
```

Ignore unrelated:

```text
agent_clicked
agent_scrolled
record_saved
```

---

# 41. Wait Result Ordering

If several relevant events already exist after `afterSeq`:

return the earliest relevant event by observation sequence.

Do not skip directly to latest session state.

The caller can wait again.

This preserves deterministic event progression.

---

# 42. Wait Timeout

Default:

```text
config.timeouts.controlWaitMs
```

currently:

```text
30000
```

Maximum:

```text
60000
```

Timeout result:

```ts
{
  event: "timeout",
  sessionId,
  controller: current.controller,
  status: current.status,
  handoff: current.handoff
}
```

Do not throw `ACTION_TIMEOUT`.

---

# 43. Session Termination Wakes Waiters

When session becomes:

```text
completed
failed
```

publish corresponding control wait event.

Pending `control.wait` calls must complete immediately.

Do not leave them hanging until timeout.

---

# 44. Runtime Shutdown

On runtime shutdown:

resolve/reject all waiters cleanly.

Preferred result:

```text
session_failed
```

only if the session itself is actually transitioned to failed.

Otherwise reject internal pending request due to runtime shutdown.

Do not fabricate durable observations solely for process shutdown unless runtime already has such policy.

---

# 45. MCP Control Tools

M7 adds/finishes exactly these MCP tools:

```text
control.status
control.request_human
control.wait
```

Do not expose:

```text
control.take_human
control.return_agent
control.set
control.transfer
```

through MCP.

Those are human-side runtime operations.

---

# 46. MCP control.status

Input:

```ts
{
  sessionId: string
}
```

Output:

```text
ControlStatus
```

Read-only.

---

# 47. MCP control.request_human

Input:

```ts
{
  sessionId: string,
  reason: string
}
```

Output:

```text
ControlStatus
```

Use runtime operation only.

No MCP-owned state.

---

# 48. MCP control.wait

Input:

```ts
{
  sessionId: string,
  afterSeq?: number,
  timeoutMs?: number
}
```

Output:

```text
ControlWaitResult
```

Keep MCP timeout slightly greater than runtime `timeoutMs` where adapter-level request timing exists.

Do not let the MCP transport kill a normal 30-second wait prematurely.

---

# 49. stdio and HTTP Equivalence

All M7 control tools must work identically over:

```text
stdio
```

and:

```text
Streamable HTTP
```

Do not implement separate control semantics per transport.

---

# 50. MCP HTTP Disconnect

If a Streamable HTTP client disconnects while:

```text
control.wait
```

is active:

cancel/unregister that waiter.

Do not alter the Rove browser session.

Do not alter controller ownership.

```text
HTTP disconnect != handoff cancellation
```

---

# 51. Private Runtime Human API

Add:

```text
GET /sessions/:id/control
```

Agent/human-neutral control status.

Human operations:

```text
POST /sessions/:id/control/take
POST /sessions/:id/control/return
```

Agent handoff request may also exist privately:

```text
POST /sessions/:id/control/request-human
```

for development/testing, though MCP remains the intended agent path.

Wait:

```text
GET /sessions/:id/control/wait?afterSeq=...&timeoutMs=...
```

or equivalent POST if repository controller conventions prefer JSON bodies.

Choose one implementation and document it.

Recommended:

```text
GET control
POST request-human
POST take
POST return
GET wait
```

---

# 52. Runtime Authentication

Human control endpoints use the existing private runtime authentication model established in M4.

Do not invent a new control token.

Use:

```text
ROVE_RUNTIME_TOKEN
```

when configured.

Future Electron uses the same private runtime trust boundary.

MCP bearer token is unrelated.

---

# 53. Actor Boundary

Do not accept:

```json
{
  "actor": "human"
}
```

from arbitrary control API payloads.

The endpoint determines actor.

Examples:

```text
/control/request-human → actor=agent semantics
/control/take          → actor=human semantics
/control/return        → actor=human semantics
```

This prevents caller-supplied actor spoofing inside the domain API.

---

# 54. Existing transferControl Migration

If existing:

```ts
transferControl(...)
```

remains in RuntimeService:

replace its public usage.

Preferred outcome:

```text
requestHuman()
takeHumanControl()
returnAgentControl()
```

call small private transition helpers where useful.

Remove generic external transfer semantics.

Do not leave MCP or HTTP routes using `actor/controller` request fields.

---

# 55. Control Transition Validation

Create centralized transition validation.

Do not scatter session-mode/state rules across controllers and MCP tools.

Suggested internal methods:

```text
ControlService.assertCanRequestHuman()
ControlService.assertCanTakeHuman()
ControlService.assertCanReturnAgent()
```

or one transition function.

Runtime remains authoritative.

---

# 56. Exact Allowed Transition Table

Use this table.

```text
AGENT MODE

active/agent
  request_human
    → awaiting_human/null

awaiting_human/null
  take_human
    → active/human

active/human
  return_agent
    → active/agent
```

No direct:

```text
active/agent → active/human
```

in Agent Mode.

---

# 57. Companion Mode Transition Table

```text
COMPANION MODE

active/agent
  request_human
    → awaiting_human/null

active/agent
  take_human
    → active/human

awaiting_human/null
  take_human
    → active/human

active/human
  return_agent
    → active/agent
```

This enables voluntary takeover.

---

# 58. Capture Mode Transition Table

For M7:

```text
CAPTURE MODE

active/human
```

remains human-controlled.

Do not allow:

```text
return_agent
```

in Capture Mode.

Return:

```text
CONTROL_NOT_OWNED
```

or a clear existing domain error.

Do not introduce Capture Mode agent control.

---

# 59. Awaiting Human State and Session Active Checks

Current session logic may treat:

```text
awaiting_human
```

as active enough for some operations.

Preserve that distinction.

Browser-changing agent mutation still fails because:

```text
controller = null
```

Read-only inspection/status remains possible.

---

# 60. Browser Actions Started Before Takeover

The existing serialized coordinator guarantees:

```text
action already executing
     ↓
finishes
     ↓
takeover occurs
```

Do not attempt to interrupt Playwright mid-click/type.

Once takeover transition is persisted, no new agent mutation may start.

---

# 61. Concurrent Agent Mutation vs Takeover

Test this race.

Schedule:

```text
slow agent action
human take request
another agent action
```

Expected ordering:

```text
slow agent action completes

human take executes
controller=human

next agent action executes validation
→ CONTROL_NOT_OWNED
```

Do not allow the second action to sneak in after takeover request.

Because the coordinator queues by invocation order, tests must verify deterministic ordering.

---

# 62. Concurrent Return vs Agent Action

When human returns control:

```text
invalidate refs
persist controller=agent
publish event
```

must occur atomically inside coordinator before a queued agent action validates ownership.

If an agent action was queued using an old target while human controlled:

after return it may own control, but its old TargetReference must fail:

```text
TARGET_STALE
```

This is required.

---

# 63. Manual Human Interaction

M7 manual testing uses the visible browser directly.

No Electron required.

Use the private runtime HTTP endpoints to:

```text
take human control
return agent control
```

while the tester physically interacts with Chrome.

This proves the domain behavior independently before M8 adds UI.

---

# 64. Fixture for Human Handoff

Reuse deterministic browser fixture.

Add a handoff-friendly page containing:

```text
Current value: <text>

[ input ]

[ Update ]
```

Human can manually:

1. type into field;
2. click update;
3. optionally navigate;
4. optionally open another tab.

The agent can inspect after handback and see the changed state.

Do not use a real authentication website in automated/manual milestone acceptance.

---

# 65. Automated Test — Request Human

Start Agent Mode:

```text
controller = agent
status = active
```

Call requestHuman.

Expect:

```text
controller = null
status = awaiting_human
handoff.reason preserved
human_requested observation
```

---

# 66. Automated Test — Duplicate Request

Request twice.

Expect:

```text
one human_requested observation
original reason preserved
same state
```

---

# 67. Automated Test — Mutation Blocked Awaiting Human

After request:

call:

```text
click
navigate
type
```

Expect:

```text
CONTROL_NOT_OWNED
```

Browser state unchanged.

---

# 68. Automated Test — Human Accepts Request

From:

```text
awaiting_human/null
```

take control.

Expect:

```text
active/human
handoff remains
human_took_control
```

---

# 69. Automated Test — Voluntary Companion Takeover

Start Companion Mode:

```text
active/agent
```

take human.

Expect:

```text
active/human
handoff undefined
human_took_control requested=false
```

---

# 70. Automated Test — Voluntary Agent Mode Takeover Rejected

Agent Mode:

```text
active/agent
```

human takes without request.

Expect:

```text
HUMAN_CONTROL_REQUIRED
```

State unchanged.

---

# 71. Automated Test — Agent Blocked During Human Control

While:

```text
controller = human
```

all mutating agent operations fail.

Verify browser did not change.

---

# 72. Automated Test — Human Return

Start human control.

Record current page revisions.

Return.

Expect:

```text
controller = agent
status = active
handoff undefined
revision incremented for all open pages
human_returned_control observation
```

---

# 73. Automated Test — Old Target Invalid

Agent:

```text
inspect
save target
request human
human take
human return
click saved target
```

Expected:

```text
TARGET_STALE
```

Then:

```text
inspect
new target
click
```

works.

---

# 74. Automated Test — Multi-Page Invalidation

Open two pages.

Inspect both.

Save refs from both.

Human takeover → return.

Both old refs must fail:

```text
TARGET_STALE
```

---

# 75. Automated Test — Active Page Synchronization

Before handoff:

```text
activePageId = page_01
```

During human control:

switch/open to:

```text
page_02
```

Return.

Expect persisted session:

```text
activePageId = page_02
```

---

# 76. Automated Test — Capture Mode

Start:

```text
mode=capture
controller=human
```

Calling take is idempotent.

Calling returnAgent:

must not give agent ownership.

---

# 77. Automated Test — control.wait Immediate Existing Event

Create control event seq 20.

Call:

```text
wait(afterSeq=19)
```

Expected:

returns immediately with seq 20.

---

# 78. Automated Test — control.wait Future Event

Start:

```text
wait(afterSeq=current)
```

Then trigger human takeover.

Wait returns:

```text
human_took_control
```

without polling.

---

# 79. Automated Test — control.wait Timeout

Call with:

```text
timeoutMs = 50
```

with no transition.

Expected:

```text
event = timeout
```

No error.

---

# 80. Automated Test — No Lost Wakeup

Explicitly test race between:

```text
initial observation query
waiter registration
```

Trigger transition in that window using test synchronization hooks.

Wait must still return event.

This test is mandatory.

---

# 81. Automated Test — Session End Wakes Wait

Start pending wait.

End session.

Expected immediate:

```text
session_completed
```

---

# 82. Automated Test — HTTP Client Disconnect

For Streamable HTTP if transport layer supports abort signal:

start `control.wait`.

Abort request.

Verify waiter removed.

Verify session remains active.

Verify controller unchanged.

---

# 83. MCP Tests

Run same control workflow through real MCP adapter.

Required over stdio:

```text
control.status
control.request_human
control.wait
```

Required over Streamable HTTP:

same three tools.

Do not test human take/return through MCP because those tools must not exist.

---

# 84. MCP Tool Enumeration Test

Assert MCP tool list includes:

```text
control.status
control.request_human
control.wait
```

Assert it does not include:

```text
control.take_human
control.return_agent
control.transfer
control.set
```

This is a security/architecture acceptance criterion.

---

# 85. Runtime HTTP Tests

Verify:

```text
GET  /sessions/:id/control

POST /sessions/:id/control/request-human

POST /sessions/:id/control/take

POST /sessions/:id/control/return
```

and control wait endpoint.

Use existing runtime auth rules.

---

# 86. Manual Verification Script

Add:

```bash
pnpm control:demo
```

Preferred root mapping:

```json
"control:demo": "pnpm --filter @rove/runtime control-demo"
```

The demo should orchestrate runtime/MCP where practical but leave human browser interaction manual.

---

# 87. Manual Verification — Agent Requested Handoff

Steps:

1. Start runtime.
2. Start/connect MCP.
3. Start Agent Mode session.
4. Navigate deterministic fixture.
5. Agent calls `browser.inspect`.
6. Save one target ref.
7. Agent calls:

```text
control.request_human
reason="Please manually update the fixture."
```

Expected:

```text
status=awaiting_human
controller=null
```

8. Attempt agent click.

Expected:

```text
CONTROL_NOT_OWNED
```

---

# 88. Manual Verification — Human Takes Control

Call private runtime:

```text
POST /sessions/<id>/control/take
```

Expected:

```text
controller=human
status=active
```

Now physically use Chrome:

* edit fixture field;
* click fixture button;
* optionally switch/open tab.

Do not use Rove browser-action API for this step.

---

# 89. Manual Verification — Human Returns

Call:

```text
POST /sessions/<id>/control/return
```

Expected:

```text
controller=agent
status=active
```

Agent calls old saved target.

Expected:

```text
TARGET_STALE
```

Agent calls:

```text
browser.inspect
```

Expected:

new page state reflects human actions.

Fresh target works.

---

# 90. Manual Verification — control.wait

Agent calls:

```text
control.request_human
```

Then:

```text
control.wait
```

Take human control through runtime endpoint.

Expected wait returns immediately:

```text
human_took_control
```

Call wait again.

Return control.

Expected:

```text
human_returned_control
```

No repeated status polling.

---

# 91. Manual Verification — Companion Voluntary Takeover

Start:

```text
mode=companion
controller=agent
```

Without agent request:

```text
POST /control/take
```

Expected:

```text
controller=human
```

Agent mutation:

```text
CONTROL_NOT_OWNED
```

Return.

Agent must re-inspect because old targets are stale.

---

# 92. Persistence Verification

Inspect:

```text
.rove/sessions/<session-id>/session.json
```

During awaiting human:

```json
{
  "status": "awaiting_human",
  "controller": null,
  "handoff": {
    "reason": "...",
    "requestedAt": "..."
  }
}
```

During human control:

```text
status=active
controller=human
handoff still present for requested handoff
```

After return:

```text
status=active
controller=agent
handoff absent
```

---

# 93. Observation Verification

Inspect:

```text
observations.jsonl
```

Expected ordered records:

```text
...
human_requested
human_took_control
human_returned_control
...
```

Sequence numbers must remain monotonic.

No duplicate transition events from idempotent requests.

---

# 94. Expected Files to Add

Likely:

```text
apps/runtime/src/control/
├── control-wait.service.ts
└── control.types.ts
```

If protocol-specific types belong elsewhere, keep them in protocol.

Runtime API:

```text
apps/runtime/src/api/control.controller.ts
```

MCP:

```text
apps/mcp/src/tools/control.tools.ts
```

or existing equivalent tools module.

Tests:

```text
apps/runtime/src/control/*.test.ts
apps/mcp/src/tools/control*.test.ts
```

Use existing package structure if M5/M6 established different exact file names.

Do not reorganize completed MCP work.

---

# 95. Expected Files to Modify

Primarily:

```text
packages/protocol/src/types.ts
packages/protocol/src/schemas.ts
packages/protocol/src/runtime.ts

apps/runtime/src/runtime.service.ts
apps/runtime/src/session/session.service.ts
apps/runtime/src/control/control.service.ts
apps/runtime/src/control/command-coordinator.ts only if necessary
apps/runtime/src/app.module.ts

apps/mcp tool registration files

README.md
docs/architecture.md

package.json
```

Browser package changes should be limited to:

```text
invalidate all targets
browser liveness/current-page synchronization
```

if M3/M4 do not already provide them.

---

# 96. Required Implementation Order

Execute exactly in this order.

## Step 1

Add protocol:

```text
HumanHandoff
ControlStatus
RequestHumanRequest
ControlWaitRequest
ControlWaitResult
```

and schemas.

## Step 2

Add optional persisted:

```text
Session.handoff
```

Update storage-compatible session schema.

## Step 3

Replace generic public `transferControl` contract with explicit runtime control operations.

## Step 4

Centralize transition validation in ControlService.

## Step 5

Implement `getControlStatus`.

## Step 6

Implement `requestHuman`.

Test idempotency and mutation blocking.

## Step 7

Implement human takeover.

Test Agent/Companion/Capture mode rules.

## Step 8

Implement all-page target invalidation/browser synchronization required for handback.

## Step 9

Implement `returnAgentControl`.

Test stale refs and active page synchronization.

## Step 10

Modify ObservationService append result if needed so transition sequence is available.

## Step 11

Implement lost-wakeup-safe ControlWaitService.

## Step 12

Ensure session completion/failure wakes waiters.

## Step 13

Add private runtime control controller.

## Step 14

Register runtime control services.

## Step 15

Implement MCP:

```text
control.status
control.request_human
control.wait
```

only.

## Step 16

Test stdio MCP.

## Step 17

Test Streamable HTTP MCP.

## Step 18

Test race cases:

```text
running action → takeover
queued action → takeover
return → stale queued target
```

## Step 19

Add:

```text
pnpm control:demo
```

## Step 20

Perform manual agent handoff workflow.

## Step 21

Perform voluntary Companion takeover workflow without Electron.

## Step 22

Run repository quality gates.

## Step 23

Update docs to describe implemented behavior only.

Stop.

Do not begin Electron/M8.

---

# 97. Quality Gates

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

All must pass.

Then manually run:

```bash
pnpm control:demo
```

Verify both:

```text
requested handoff
```

and:

```text
voluntary Companion takeover
```

---

# 98. Explicitly Out of Scope

Do not implement:

```text
Electron UI
desktop notifications

Capture Mode human event recording

automatic authentication detection
automatic CAPTCHA detection
automatic MFA detection
automatic "human finished" detection

browser action cancellation

multi-user control
multiple humans
multiple agents

remote desktop
screen streaming

MCP human-control tools

generic control.set
generic actor field from callers

cloud coordination
distributed locks

WebSocket infrastructure
Redis pub/sub
queues
database
```

---

# 99. Decision Summary

There are no open implementation decisions for M7.

Runtime owns control:

```text
authoritative
```

Controller:

```text
agent | human | null
```

Requested handoff:

```text
active/agent
→ awaiting_human/null
→ active/human
→ active/agent
```

Companion voluntary takeover:

```text
active/agent
→ active/human
→ active/agent
```

Agent Mode voluntary human takeover:

```text
not allowed without request_human
```

Capture Mode:

```text
human remains controller
```

Handoff reason:

```text
persisted on Session.handoff
```

Agent-side MCP tools:

```text
control.status
control.request_human
control.wait
```

Human-side MCP tools:

```text
none
```

Human control operations:

```text
private runtime API
```

Generic caller-supplied actor/controller transfer:

```text
removed from external API
```

Control transfer boundary:

```text
existing BrowserCommandCoordinator
```

Running browser action:

```text
allowed to finish
```

New agent actions after takeover:

```text
CONTROL_NOT_OWNED
```

Human → agent return:

```text
invalidate every page's targets first
then restore agent ownership
```

Old refs:

```text
TARGET_STALE
```

Wait mechanism:

```text
in-memory event waiters
+
durable observation recheck
```

Polling:

```text
not used
```

Default wait:

```text
30 seconds
```

Maximum wait:

```text
60 seconds
```

Timeout:

```text
normal result
not error
```

Transport behavior:

```text
same over stdio and Streamable HTTP
```

HTTP disconnect:

```text
cancels waiter only
does not alter Rove session
```

Electron:

```text
explicitly deferred to M8
```

This runbook is the implementation authority for Milestone 7.
