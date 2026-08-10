# Rove — Milestones 3 & 4 Implementation Runbook

## Purpose

This document is the authoritative implementation runbook for:

* **Milestone 3 — Browser Actions & Stale Target Protection**
* **Milestone 4 — Runtime Sessions, Browser Integration & Persistence**

Execute this plan directly.

Do not redesign Rove.

Do not perform broad repository exploration.

Do not reconsider decisions specified here.

Do not implement MCP.

Do not implement Electron.

Do not implement human observation or Capture Mode beyond preserving the already-defined session/control rules.

At the end of these milestones, this complete path must work:

```text
Runtime session.start
        ↓
Playwright browser launches
        ↓
browser.navigate
        ↓
browser.inspect
        ↓
TargetReference
        ↓
browser.click / type / press
        ↓
browser state changes
        ↓
structured ActionResult
        ↓
observation persisted
        ↓
evidence persisted
        ↓
session.end
        ↓
browser closes
```

---

# 1. Preconditions

Milestones 1 and 2 must already provide:

```text
PlaywrightBrowserEngine
PlaywrightBrowserSession
PageRegistry
PageState
PageInspector
TargetRegistry
TargetIdentity
semantic inspect()
temporary browser profile
navigate()
pages()
switchPage()
closePage()
invalidateTargets()
deterministic fixture server
browser:demo
browser:inspect
```

Do not reimplement these.

If exact file names differ from the M1/M2 runbook, use the existing implementation that provides these responsibilities.

---

# 2. Existing Architecture — Preserve

Architecture remains:

```text
packages/browser
    ↓
Playwright implementation

apps/runtime
    ↓
application/session/control orchestration

packages/storage
    ↓
filesystem persistence

packages/protocol
    ↓
shared contracts

apps/mcp
    ↓
NOT PART OF M3/M4
```

Rules:

```text
Playwright stays in packages/browser.

Runtime does not construct selectors.

Runtime does not inspect DOM directly.

Browser package does not own Rove runtime sessions.

Storage package does not own domain behavior.
```

---

# 3. Existing Browser Contract — Complete It

The existing `BrowserSession` contract remains authoritative:

```ts
export interface BrowserSession {
  readonly id: string;

  inspect(options?: InspectOptions): Promise<PageInspection>;

  navigate(url: string): Promise<ActionResult>;

  click(target: TargetReference): Promise<ActionResult>;

  type(
    target: TargetReference,
    value: string
  ): Promise<ActionResult>;

  press(
    target: TargetReference | null,
    key: string
  ): Promise<ActionResult>;

  scroll(options: ScrollOptions): Promise<ActionResult>;

  back(): Promise<ActionResult>;

  forward(): Promise<ActionResult>;

  screenshot(
    options?: ScreenshotOptions
  ): Promise<Artifact>;

  pages(): Promise<PageSummary[]>;

  switchPage(pageId: string): Promise<PageSummary>;

  closePage(pageId: string): Promise<void>;

  invalidateTargets(): Promise<void>;

  close(): Promise<void>;
}
```

M3 completes the previously unimplemented methods:

```text
click
type
press
scroll
back
forward
screenshot
```

Do not expand the browser contract with:

```text
hover
select
check
uncheck
JavaScript execution
raw selectors
```

Those are not required for M3.

---

# 4. Existing Errors — Use Them

Use the existing error codes.

Relevant M3 errors:

```text
PAGE_NOT_FOUND
PAGE_CHANGED

TARGET_NOT_FOUND
TARGET_STALE
TARGET_AMBIGUOUS
TARGET_NOT_VISIBLE
TARGET_DISABLED
TARGET_NOT_INTERACTIVE

NAVIGATION_FAILED
ACTION_TIMEOUT
BROWSER_CLOSED
```

Relevant M4 errors:

```text
SESSION_NOT_FOUND
SESSION_NOT_ACTIVE
SESSION_ALREADY_ENDED

CONTROL_NOT_OWNED

EVIDENCE_NOT_FOUND
EVIDENCE_WRITE_FAILED
```

Do not add new codes unless absolutely impossible to express a real failure using the existing protocol.

---

# 5. Milestone 3 Goal

Complete the core safe browser interaction loop:

```text
inspect
   ↓
target ref
   ↓
resolve same target
   ↓
validate target
   ↓
perform action
   ↓
observe resulting page
   ↓
update revisions if necessary
   ↓
structured result
```

The most important invariant is:

> Rove must never silently reinterpret an old target reference as a different DOM element.

---

# 6. M3 Internal Components

Expected additions:

```text
packages/browser/src/targets/
├── target-resolver.ts
└── target-state.ts

packages/browser/src/actions/
├── action-runner.ts
└── action-errors.ts

packages/browser/src/mutations/
└── mutation-tracker.ts
```

Exact internal splitting may vary if M1/M2 already has nearby files.

Do not create abstractions that have only one trivial call site.

---

# 7. Target Handle Strategy

M2 uses an ephemeral internal Rove DOM marker such as:

```html
data-rove-target="r1"
```

Continue using this approach.

A registered target handle should contain only internal information required to resolve it.

Conceptually:

```ts
interface PlaywrightTargetHandle {
  marker: string;
}
```

Do not store a long-lived Playwright `ElementHandle`.

Do not expose the marker publicly.

Do not expose CSS selectors publicly.

At action time, create a fresh Playwright Locator using the internal marker.

---

# 8. Target Resolution Pipeline

Every target-based action must call one shared target resolver.

Pipeline:

```text
TargetReference
      ↓
verify pageId
      ↓
verify revision
      ↓
TargetRegistry.resolve()
      ↓
resolve internal DOM marker
      ↓
verify exactly one element
      ↓
re-read semantic identity
      ↓
verify same logical element
      ↓
verify visibility
      ↓
verify enabled/interactable state
      ↓
return locator
```

Do not duplicate this logic in `click()`, `type()`, and `screenshot()`.

---

# 9. Missing DOM Marker

If the registered marker no longer exists:

```text
TARGET_STALE
```

Use:

```text
retryable = true
```

Do not return `TARGET_NOT_FOUND`.

`TARGET_NOT_FOUND` means Rove does not know the reference.

`TARGET_STALE` means Rove knew the reference but its associated DOM target is no longer safely usable.

---

# 10. Multiple DOM Markers

The internal marker should be unique.

If locator resolution unexpectedly finds more than one node:

```text
TARGET_AMBIGUOUS
```

Do not pick the first match.

---

# 11. Identity Verification

M2 stored `TargetIdentity`.

At action time, regenerate identity information for the current marked DOM node using the same semantic extraction rules used during inspection.

Verify identity conservatively.

Strong identity fields:

```text
tag
type
id
testId
role
name
```

Rules:

* if an originally recorded strong field existed and now differs materially, treat the reference as stale;
* whitespace-normalize names before comparison;
* case-normalize HTML tag/type/role values;
* absence of an optional weak hint alone is not necessarily stale;
* `domPathHint` is supporting evidence only;
* do not use fuzzy similarity to rescue changed targets.

If the resolver cannot confidently establish the same logical target:

```text
TARGET_STALE
```

Do not search the page for another element with the same text.

---

# 12. Material DOM Mutation Tracking

M3 introduces mutation tracking.

Do not invalidate targets for every DOM mutation.

Modern pages mutate continuously.

Inject one lightweight `MutationObserver` per page.

Track a browser-side:

```text
materialMutationVersion
```

Increment it only when a mutation is relevant to interaction safety.

Material mutation rules:

## Child-list changes

Consider material when added/removed nodes:

* are interactive elements;
* contain interactive elements;
* replace/remove an element carrying `data-rove-target`;
* occur inside an element carrying `data-rove-target`.

## Attribute changes

Observe only interaction-relevant attributes:

```text
disabled
hidden
style
class
role
type
href
id
name
tabindex
aria-label
aria-labelledby
aria-disabled
aria-hidden
contenteditable
```

Attribute changes to a currently registered Rove target are material.

Do not consider:

```text
data-rove-target
```

itself a material mutation.

Rove's own instrumentation must never invalidate Rove targets.

---

# 13. Mutation Revision Synchronization

Each inspected page tracks:

```text
PageState.mutationVersion
```

and:

```text
PageState.revision
```

Before target action resolution:

1. read current browser-side material mutation version;
2. compare with the version recorded at last target inspection;
3. if unchanged, continue;
4. if changed, determine whether currently registered target markers remain safe;
5. if the requested target is missing or identity changed:

   * increment page revision;
   * invalidate TargetRegistry;
   * return `TARGET_STALE`;
6. if mutation was unrelated and requested target remains semantically identical:

   * synchronize mutation version;
   * allow action.

This avoids invalidating every target because an unrelated page component changed.

---

# 14. Navigation Remains Material

Main-frame navigation always:

```text
revision++
```

and:

```text
TargetRegistry invalidated
```

No target from the previous document may survive document navigation.

---

# 15. Action Timeouts

Use:

```text
10 seconds
```

as default action timeout.

Navigation/history navigation continues to use:

```text
30 seconds
```

Do not globally modify Playwright defaults in a way that affects unrelated operations.

Use explicit timeout values in action helpers.

Runtime configuration integration in M4 may supply these values later.

---

# 16. click()

Implementation:

```text
resolve target
    ↓
verify target interactive
    ↓
locator.click()
    ↓
wait only for Playwright action completion
    ↓
synchronize page state
    ↓
return ActionResult
```

Do not automatically wait for `networkidle`.

Do not automatically perform another click if Playwright reports uncertainty.

Do not force-click hidden/covered elements.

Do not use:

```ts
force: true
```

by default.

If element is not visible:

```text
TARGET_NOT_VISIBLE
```

If disabled:

```text
TARGET_DISABLED
```

If semantic target is not actionable:

```text
TARGET_NOT_INTERACTIVE
```

---

# 17. ActionResult for click()

Return:

```ts
{
  ok: true,
  action: "click",
  sessionId: browserSession.id,
  pageId,
  pageChanged,
  previousRevision,
  currentRevision,
  url,
  openedPages
}
```

`pageChanged` is true if any of:

* main page URL changed;
* page revision changed;
* new page opened;
* active page changed.

Otherwise false.

---

# 18. Popup Handling

Before executing click:

capture current set of page IDs.

After click:

allow the BrowserContext page listener from M1 to register new pages.

Wait only a short deterministic grace period:

```text
up to 500 ms
```

for synchronously opened popup/page events.

Do not sleep 500 ms unconditionally.

Use event/promise race where practical.

Return newly opened pages in:

```text
openedPages
```

If a popup becomes active under existing M1 rules, return its page summary.

---

# 19. type()

`BrowserSession.type()` means:

> Replace the editable target's current text value with the supplied value.

Use:

```ts
locator.fill(value)
```

for:

```text
input
textarea
contenteditable
```

where Playwright supports fill semantics.

Do not use deprecated/slow character-by-character typing as the default.

Do not append to existing text.

If target does not accept text:

```text
TARGET_NOT_INTERACTIVE
```

---

# 20. Sensitive type()

Before entering text:

reuse:

```text
isSensitiveTarget(identity)
```

No new sensitivity classifier.

Sensitive values must never be placed in:

* errors;
* action result;
* browser logs;
* test snapshots;
* observations;
* evidence metadata.

`ActionResult` contains no typed value for either normal or sensitive input.

---

# 21. press()

Two supported modes.

## Target supplied

```text
resolve target
    ↓
locator.press(key)
```

## Target null

Use active page:

```ts
page.keyboard.press(key)
```

Examples:

```text
Enter
Tab
Escape
ArrowDown
Control+A
Meta+A
```

Do not invent a key whitelist.

Let Playwright validate supported key syntax.

Translate expected failures into stable Rove errors.

---

# 22. scroll()

`ScrollOptions` remains:

```ts
{
  direction: "up" | "down" | "left" | "right";
  amount?: number;
}
```

Default:

```text
amount = 600 CSS pixels
```

Amount must be positive.

Map:

```text
up    → y = -amount
down  → y = +amount
left  → x = -amount
right → x = +amount
```

Use:

```ts
page.mouse.wheel(x, y)
```

on the active page.

Do not attempt element-targeted scrolling in M3.

After scroll, return:

```text
pageChanged = false
```

unless an actual material revision/page change occurred during execution.

---

# 23. back()

Use:

```ts
page.goBack({
  waitUntil: "domcontentloaded",
  timeout: navigationTimeout
})
```

If browser has no back-history and Playwright returns `null`:

return successful:

```text
pageChanged = false
```

Do not classify lack of history as failure.

If navigation occurs:

```text
revision++
TargetRegistry invalidated
pageChanged = true
```

---

# 24. forward()

Same semantics as `back()`.

No history:

```text
ok = true
pageChanged = false
```

Actual navigation:

```text
revision++
TargetRegistry invalidated
```

---

# 25. screenshot()

Implement all existing screenshot modes:

```text
viewport
full-page
target
```

Default:

```text
viewport
```

Return existing:

```ts
Artifact
```

with:

```text
mimeType = image/png
bytes = PNG bytes
```

Metadata:

```ts
{
  pageId,
  revision,
  url,
  mode,
  timestamp
}
```

Do not write screenshots to arbitrary filesystem locations in the browser package.

M4 will persist them as evidence.

---

# 26. Viewport Screenshot

Use:

```ts
page.screenshot({
  type: "png",
  fullPage: false
})
```

No path.

Return bytes.

---

# 27. Full-Page Screenshot

Use:

```ts
page.screenshot({
  type: "png",
  fullPage: true
})
```

No path.

---

# 28. Target Screenshot

Require:

```text
options.target
```

Resolve with the normal target resolver.

Use:

```ts
locator.screenshot({
  type: "png"
})
```

If `mode="target"` without a target:

fail using an existing structured configuration/interaction error.

Prefer:

```text
TARGET_NOT_FOUND
```

with clear message:

```text
Target screenshot requires a TargetReference.
```

Do not introduce a special screenshot error code.

---

# 29. Screenshot Sensitive-Field Protection

Screenshots must avoid exposing unmasked sensitive text fields such as OTP inputs.

Immediately before screenshot:

temporarily apply visual masking only to elements classified as sensitive.

Do not alter their values.

Use a temporary Rove CSS class/style implementing browser visual text masking such as:

```css
-webkit-text-security: disc !important;
```

where applicable.

For native:

```html
input type="password"
```

the browser already masks rendering.

For:

```text
autocomplete=one-time-code
semantic OTP/passcode fields
```

apply the temporary visual mask.

After screenshot:

restore/remove Rove masking in `finally`.

Rove screenshot instrumentation must not count as a material page mutation.

For target screenshots of a sensitive input, the captured rendered text must remain masked.

---

# 30. Action Result State Synchronization

Create one shared helper after browser actions:

```ts
synchronizeAfterAction(...)
```

Responsibilities:

* current URL;
* title where cheap;
* current revision;
* newly opened pages;
* active page;
* pageChanged calculation.

Do not duplicate state reconciliation in each action implementation.

---

# 31. M3 Deterministic Fixture Expansion

Extend existing fixture server.

Add routes/pages:

```text
/actions
/result
/history-a
/history-b
/popup
/dynamic-target
```

`/actions` must contain:

```text
text input
password input
OTP-like input
button changing text/state
button navigating
button opening popup
button disabled
hidden button
scrollable long content
```

`/dynamic-target` must provide deterministic DOM replacement.

Example:

```text
Inspect
 ↓
receive t3 for "Replace me"
 ↓
fixture JS replaces button node
 ↓
click old t3
 ↓
TARGET_STALE
```

---

# 32. M3 Automated Tests

Required tests:

## Click

Inspect fixture.

Resolve button.

Click.

Verify fixture state changed.

---

## Navigation click

Click link/button causing navigation.

Verify:

```text
pageChanged = true
revision increased
old refs stale
```

---

## Type

Existing field:

```text
before = old text
```

Call:

```text
type(target, "backend")
```

Verify exact value:

```text
backend
```

not appended text.

---

## Sensitive type

Call:

```text
type(passwordTarget, "super-secret-test-value")
```

Verify the value never occurs in:

* returned ActionResult;
* serialized errors;
* test logging;
* metadata produced by browser API.

---

## Press

Target input:

```text
press(target, "Enter")
```

works.

Null target:

```text
press(null, "Escape")
```

works.

---

## Scroll

Verify document scroll position changes approximately in requested direction.

---

## Back/forward

Navigate fixture A → B.

Back returns A.

Forward returns B.

Revision changes appropriately.

---

## No history

Back on initial page returns:

```text
ok = true
pageChanged = false
```

---

## Viewport screenshot

Verify:

```text
mimeType = image/png
bytes.length > 0
```

---

## Full-page screenshot

Same.

---

## Target screenshot

Valid target produces PNG bytes.

---

## Sensitive screenshot

OTP/password fixture rendered screenshot must use masking instrumentation.

Test DOM value remains unchanged after screenshot.

---

## Disabled target

Returns:

```text
TARGET_DISABLED
```

---

## Hidden target

Returns:

```text
TARGET_NOT_VISIBLE
```

when a previously inspected target becomes hidden.

---

## Replaced target

Old target returns:

```text
TARGET_STALE
```

Rove must not click replacement.

---

## Ambiguous internal marker

Artificial test duplicate marker:

```text
TARGET_AMBIGUOUS
```

---

## Unrelated mutation

Change unrelated page content while inspected button remains the same.

Button should remain safely actionable.

Do not stale everything unnecessarily.

---

# 33. M3 Manual Demo

Add:

```bash
pnpm browser:actions
```

Preferred root mapping:

```json
"browser:actions": "pnpm --filter @rove/browser actions-demo"
```

Demo sequence:

```text
launch headed browser
 ↓
open deterministic fixture
 ↓
inspect
 ↓
type into search field using TargetReference
 ↓
click submit using TargetReference
 ↓
inspect resulting state
 ↓
go back
 ↓
scroll
 ↓
capture screenshot
 ↓
run stale-target example
 ↓
print TARGET_STALE
 ↓
wait for Enter
 ↓
close
```

No CSS selectors may be supplied by the demo caller.

The demo must operate using Rove target refs.

---

# 34. M3 Definition of Done

M3 is complete when:

* [ ] target resolver is centralized;
* [ ] target page/revision is validated;
* [ ] DOM marker is re-resolved at action time;
* [ ] semantic identity is rechecked;
* [ ] missing/replaced targets return `TARGET_STALE`;
* [ ] Rove never guesses replacement targets;
* [ ] relevant material mutations are tracked;
* [ ] unrelated mutations do not automatically stale every target;
* [ ] click works;
* [ ] type works using replacement/fill semantics;
* [ ] sensitive type values never appear in output;
* [ ] press works with and without target;
* [ ] scroll works;
* [ ] back works;
* [ ] forward works;
* [ ] viewport screenshot works;
* [ ] full-page screenshot works;
* [ ] target screenshot works;
* [ ] sensitive screenshot masking works;
* [ ] popups/new pages are reflected;
* [ ] deterministic tests pass;
* [ ] `pnpm browser:actions` passes manual verification;
* [ ] lint/typecheck/test/build pass.

---

# 35. Milestone 4 Goal

M4 connects the real browser implementation to the authoritative Rove runtime.

Current runtime already has:

```text
SessionService
BrowserService
ControlService
BrowserCommandCoordinator
ObservationService
EvidenceService
RuntimeService
filesystem stores
```

Reuse them.

Do not create a second runtime architecture.

---

# 36. M4 Core Flow

`session.start` becomes:

```text
validate request
     ↓
persist status=starting
     ↓
launch BrowserSession
     ↓
optionally navigate startUrl
     ↓
discover active page
     ↓
persist status=active + activePageId
     ↓
append session_started observation
     ↓
return Session
```

On browser launch failure:

```text
persist status=failed
controller=null
endedAt=<now>
     ↓
append session_failed observation
     ↓
rethrow structured browser failure
```

Do not leave failed startup sessions marked active.

---

# 37. Session Starting State

Change `SessionService.start()`.

Initial record:

```ts
{
  status: "starting",
  controller:
    mode === "capture"
      ? "human"
      : "agent"
}
```

Persist immediately.

Do not append the final `session_started` observation until browser startup succeeds.

---

# 38. Browser Launch Configuration

Runtime constructs:

```ts
BrowserLaunchConfig
```

from:

```text
Rove config
+
StartSessionRequest.profile
```

Mapping:

```ts
{
  headless: config.browser.headless,
  browser: config.browser.preferredBrowser,
  profile: request.profile
}
```

Do not duplicate Chrome/Chromium fallback logic.

That remains inside `PlaywrightBrowserEngine`.

---

# 39. Profile Behavior

M4 simply passes profile configuration into the browser engine.

If M1 still only supports:

```text
temporary
```

then persistent/existing profile requests propagate structured `NOT_IMPLEMENTED`/profile errors and session becomes failed.

Do not implement persistent profile support as part of M4.

---

# 40. startUrl

When:

```text
request.startUrl
```

is present:

launch browser first, then navigate using BrowserSession.

This initial navigation is part of startup.

After navigation:

set:

```text
activePageId
```

to actual active Rove browser page.

Do not create a separate browser navigation implementation in runtime.

---

# 41. BrowserService Lifecycle

Current mapping:

```ts
Map<sessionId, BrowserSession>
```

is correct.

Keep it.

Improve lifecycle rules:

* reject accidental second browser attachment for same session;
* remove map entry before/while closing safely;
* closing missing browser remains idempotent;
* expose helper for `has(sessionId)` if required by tests;
* no Playwright types.

---

# 42. Runtime Owns Runtime Session ID

Browser `ActionResult` currently uses:

```text
BrowserSession.id
```

in its required `sessionId` field.

At runtime boundary normalize it.

Every RuntimeService browser action returns:

```ts
{
  ...browserResult,
  sessionId: roveSessionId
}
```

External application adapters must never mistake browser-engine IDs for:

```text
ses_...
```

---

# 43. Runtime Browser API Surface

Expand `RoveRuntime` to expose the complete implemented browser surface needed by M5.

Add:

```ts
press(...)
scroll(...)
back(...)
forward(...)
pages(...)
switchPage(...)
closePage(...)
captureScreenshot(...)
```

Do not wait until MCP milestone to invent these runtime methods.

MCP should later adapt an already complete application API.

---

# 44. Protocol Requests

Add shared request types/schemas only where needed.

Use:

```ts
PressRequest
ScrollOptions
ScreenshotOptions
```

already available where applicable.

Add lightweight schemas for HTTP validation if missing.

For page switching:

```ts
interface SwitchPageRequest {
  pageId: string;
}
```

Avoid wrapping path parameters unnecessarily in domain APIs.

---

# 45. Runtime Mutation Pipeline

All agent browser-changing operations use the existing:

```text
BrowserCommandCoordinator
```

and:

```text
ControlService.assertCanMutate()
```

Pipeline:

```text
coordinator.execute(sessionId)
       ↓
require active session
       ↓
assert controller = agent
       ↓
execute BrowserSession action
       ↓
normalize ActionResult.sessionId
       ↓
synchronize session activePageId
       ↓
persist session update if changed
       ↓
append observation
       ↓
return result
```

Do not add another mutex.

---

# 46. Read-Only Operations

These do not require agent ownership:

```text
getSession
inspectBrowser
pages
getObservations
listEvidence
readEvidence
```

They still require a valid session.

`inspectBrowser` requires session to be non-terminal/active for live browser inspection.

Historical observation/evidence reads may work after session completion.

---

# 47. Browser-Changing Operations

These require:

```text
controller === agent
```

during M4 API usage:

```text
navigate
click
type
press
scroll
back
forward
switchPage
closePage
captureScreenshot
```

Screenshot is treated as a browser/evidence operation and must be serialized with other agent actions.

Do not allow agent screenshot capture while human control is active yet.

Human-specific browser access is implemented later with Companion/Handoff milestones.

---

# 48. Session activePageId

After browser startup:

```text
session.activePageId = active browser page ID
```

Update this after:

```text
navigate
click
press
back
forward
switchPage
closePage
```

when active page changes.

Do not write session.json after every action if the activePageId and status did not actually change.

Observations are persisted separately.

---

# 49. Runtime Action Observations

Every successful browser mutation creates one observation.

Use stable names:

```text
browser_navigated
agent_clicked
agent_typed
agent_pressed
agent_scrolled
browser_back
browser_forward
page_switched
page_closed
```

Use:

```text
actor = agent
```

for agent-requested interaction events except naturally browser-generated lifecycle facts if already emitted separately.

---

# 50. Observation Data Minimization

Observation payloads must be compact.

Navigate:

```ts
{
  url: result.url,
  previousRevision,
  currentRevision
}
```

Click:

```ts
{
  targetRef: request.target.ref,
  pageChanged: result.pageChanged,
  url: result.url
}
```

Type:

```ts
{
  targetRef: request.target.ref
}
```

Never include:

```text
request.value
```

even for non-sensitive typed values.

This creates one simple invariant:

> Rove observations never persist raw typed values.

This is stricter and easier to verify.

---

# 51. Press Observation

Store:

```ts
{
  targetRef: request.target?.ref,
  key: request.key
}
```

Keys are not treated as secret values.

Do not record text generated by the key event.

---

# 52. Scroll Observation

Store:

```ts
{
  direction,
  amount
}
```

---

# 53. Failed Actions

For M4, do not append a normal success observation for failed actions.

Optional structured failure logging is not part of the durable observation model yet.

Let error propagate.

Do not add `action_failed` observations unless required by an existing runtime pattern.

---

# 54. Inspection Observations

Do not persist an observation for every:

```text
browser.inspect
```

Inspection is a read operation and will be frequent.

Persisting each inspection would generate low-value noise.

---

# 55. Screenshot Runtime Semantics

The browser package returns:

```ts
Artifact
```

The runtime does not return raw screenshot bytes through its normal application/API boundary.

Instead:

```text
BrowserSession.screenshot()
      ↓
Artifact
      ↓
EvidenceService
      ↓
filesystem
      ↓
Evidence metadata returned
```

Add:

```ts
captureScreenshot(
  sessionId: string,
  options?: ScreenshotOptions
): Promise<Evidence>
```

to `RoveRuntime`.

This becomes the future implementation behind MCP:

```text
browser.screenshot
```

---

# 56. Screenshot Evidence

Persist under:

```text
.rove/sessions/<session-id>/evidence/screenshots/
```

Use Rove-generated filenames.

Example:

```text
ev_<id>.png
```

Do not accept caller-supplied paths.

Evidence metadata:

```ts
{
  id,
  sessionId,
  type: "screenshot",
  pageId,
  pageRevision,
  url,
  createdAt,
  metadata: {
    mimeType: "image/png",
    mode: "viewport" | "full-page" | "target"
  }
}
```

---

# 57. Binary Evidence Storage

Extend internal evidence storage so:

```text
Uint8Array
```

can be persisted.

The existing TypeScript `EvidencePayload` already allows binary payload conceptually.

Do not expose binary payload through JSON request schemas.

External `saveEvidence` remains:

```text
string | structured record
```

Browser screenshot persistence uses an internal service/storage call accepting bytes.

---

# 58. Structured Record Evidence

Continue using:

```text
evidence.save_record
```

semantics already represented by `SaveEvidenceRequest`.

Store records under:

```text
evidence/records/
```

Do not prescribe record fields.

Agent owns record shape.

---

# 59. Evidence Read/List Runtime Surface

Add runtime operations:

```ts
listEvidence(sessionId)
readEvidence(sessionId, evidenceId)
```

These should use existing EvidenceService/Store.

For binary screenshot read through private HTTP API:

do not inline raw bytes into generic JSON evidence metadata endpoint.

M4 only needs:

```text
metadata listing
+
dedicated binary file response if implemented
```

MCP evidence binary behavior can be handled later.

---

# 60. Session End Ordering

Current implementation ends the session before closing browser.

Change ordering to make final state more accurate.

Use:

```text
coordinator.execute(sessionId)
      ↓
verify session exists/not terminal
      ↓
prevent new actions
      ↓
close browser
      ↓
persist completed session
controller = null
endedAt = now
      ↓
append session_completed
```

Do not leave an active browser attached after session becomes completed.

If browser close itself fails:

* still attempt to persist session terminal state;
* surface the close error if meaningful;
* do not leave controller assigned.

---

# 61. Session Start Failure

Flow:

```text
Session(starting) persisted
      ↓
Browser launch throws
      ↓
Session(failed) persisted
controller=null
endedAt=now
      ↓
session_failed observation
      ↓
throw browser error
```

Do not delete the failed session directory.

A failed startup is useful historical evidence.

---

# 62. Runtime Startup Recovery

Full live browser recovery remains out of scope.

On process restart:

historical sessions remain readable from storage.

Do not attempt to reattach to old Playwright browser processes.

M4 may optionally detect non-terminal historical sessions and leave them unchanged.

Do not build crash reconciliation in this milestone.

---

# 63. Private Runtime HTTP API

The runtime remains:

```text
127.0.0.1:47820
```

by default.

Do not expose publicly by default.

Add browser/evidence/observation routes.

---

# 64. Runtime HTTP Route Set

Implement:

```text
POST /sessions
GET  /sessions/:id
POST /sessions/:id/end
```

Browser:

```text
POST /sessions/:id/browser/navigate
POST /sessions/:id/browser/inspect
POST /sessions/:id/browser/click
POST /sessions/:id/browser/type
POST /sessions/:id/browser/press
POST /sessions/:id/browser/scroll
POST /sessions/:id/browser/back
POST /sessions/:id/browser/forward
POST /sessions/:id/browser/screenshot

GET  /sessions/:id/browser/pages
POST /sessions/:id/browser/pages/:pageId/switch
DELETE /sessions/:id/browser/pages/:pageId
```

Observations:

```text
GET /sessions/:id/observations
```

Query:

```text
afterSeq
limit
```

Evidence:

```text
POST /sessions/:id/evidence
GET  /sessions/:id/evidence
GET  /sessions/:id/evidence/:evidenceId
```

Keep:

```text
GET /health
```

---

# 65. Controller Structure

Do not put everything into existing:

```text
SessionController
```

Create:

```text
BrowserController
ObservationController
EvidenceController
```

Keep controllers thin.

They must:

```text
parse request
 ↓
call RuntimeService
 ↓
return result
```

No browser logic.

No filesystem logic.

---

# 66. Runtime API Authentication

Use existing:

```text
config.runtime.token
```

behavior.

Rules:

## `/health`

Always accessible without token.

## `/sessions/**`

When:

```text
ROVE_RUNTIME_TOKEN
```

is configured:

require:

```http
Authorization: Bearer <token>
```

When running loopback with no runtime token:

allow local unauthenticated development access.

When configured runtime host is non-loopback:

startup must require a runtime token.

If non-loopback + no token:

fail startup with:

```text
INVALID_CONFIGURATION
```

Do not generate and print a secret automatically in M4.

This keeps local development simple and prevents unauthenticated public binding.

---

# 67. Runtime Token Handling

Never log:

```text
ROVE_RUNTIME_TOKEN
Authorization header
```

Use centralized guard/middleware.

Do not repeat auth checks in every controller.

This token is separate from future:

```text
ROVE_MCP_TOKEN
```

---

# 68. Runtime Error HTTP Shape

Ensure `RoveError` becomes stable JSON:

```json
{
  "ok": false,
  "error": {
    "code": "TARGET_STALE",
    "message": "...",
    "retryable": true
  }
}
```

Do not expose NestJS stack traces as API responses.

Add one exception filter for `RoveError`.

Unexpected errors should not reveal secrets/internal stack to API clients.

---

# 69. HTTP Status Mapping

Use:

```text
SESSION_NOT_FOUND       → 404
PAGE_NOT_FOUND          → 404
EVIDENCE_NOT_FOUND      → 404

CONTROL_NOT_OWNED       → 409
TARGET_STALE            → 409
PAGE_CHANGED            → 409
SESSION_ALREADY_ENDED   → 409

TARGET_DISABLED         → 422
TARGET_NOT_VISIBLE      → 422
TARGET_NOT_INTERACTIVE  → 422

INVALID_CONFIGURATION   → 400

BROWSER_CLOSED          → 410

ACTION_TIMEOUT          → 504

other known RoveError   → 400 or 500 based on semantics
```

Do not make clients parse human-readable messages to understand errors.

---

# 70. Runtime Timeout Integration

M4 connects configured timeouts to browser runtime behavior.

Current config already contains:

```text
navigationMs = 30000
actionMs = 10000
inspectMs = 5000
controlWaitMs = 30000
```

Avoid changing the public browser launch contract solely for timeouts if unnecessary.

Preferred implementation:

add an internal browser engine/session timeout configuration in the smallest compatible way.

If `BrowserLaunchConfig` must be extended, add:

```ts
timeouts?: {
  navigationMs?: number;
  actionMs?: number;
  inspectMs?: number;
}
```

and corresponding schema/type support.

Do not introduce global mutable timeout state.

---

# 71. Observation Sequence

Existing observation storage behavior remains authoritative:

```text
append-only
monotonic seq per session
```

Do not derive sequence numbers from timestamps.

Do not reset sequence numbers after process restart.

Use existing ObservationService/Store.

---

# 72. Persistence

Continue existing layout:

```text
.rove/
└── sessions/
    └── <session-id>/
        ├── session.json
        ├── observations.jsonl
        └── evidence/
            ├── screenshots/
            ├── records/
            ├── pages/
            └── files/
```

Do not introduce a database.

---

# 73. Incremental Persistence

Required ordering:

For session transitions:

```text
domain change
 ↓
persist session
 ↓
return
```

For observations:

```text
successful event
 ↓
append observation
 ↓
return completed operation
```

For screenshot evidence:

```text
write screenshot bytes
 ↓
write evidence metadata
 ↓
append evidence observation
 ↓
return Evidence
```

A successful API response must not claim persistence happened when it did not.

---

# 74. Evidence Failure

If screenshot bytes cannot be written:

```text
EVIDENCE_WRITE_FAILED
```

Do not return a successful `Evidence` object.

Do not append `screenshot_captured` observation.

---

# 75. M4 Runtime Observation Names

Use exactly:

```text
session_started
session_completed
session_failed

browser_navigated
agent_clicked
agent_typed
agent_pressed
agent_scrolled
browser_back
browser_forward

page_switched
page_closed

screenshot_captured
record_saved
```

Do not create multiple competing names for the same event.

---

# 76. M4 Tests — Session Startup

Start temporary Agent session.

Verify:

```text
session.id starts ses_
status = active
controller = agent
activePageId = page_01
```

Verify real BrowserSession exists in BrowserService.

Verify:

```text
session.json
```

exists.

Verify:

```text
session_started
```

observation exists.

---

# 77. Capture Session Initialization

Even though full Capture Mode is later, preserve existing domain rule.

Start:

```text
mode = capture
```

Verify:

```text
controller = human
```

Agent mutation:

```text
CONTROL_NOT_OWNED
```

Do not implement human browser instrumentation here.

---

# 78. Companion Session Initialization

Start:

```text
mode = companion
```

Verify:

```text
controller = agent
```

No Electron work.

---

# 79. Start URL Test

Start session with:

```text
startUrl = fixture URL
```

Verify browser opens fixture.

Verify:

```text
activePageId
```

is persisted.

Verify navigation state is correct.

---

# 80. Startup Failure Test

Use intentionally failing browser configuration.

Verify:

```text
session.status = failed
controller = null
endedAt exists
```

Verify:

```text
session_failed
```

observation.

---

# 81. Runtime Inspect Test

Through `RuntimeService`:

```text
start
navigate
inspect
```

Verify PageInspection from real browser is returned unchanged except runtime orchestration.

Runtime must not reconstruct inspection.

---

# 82. Runtime Click Test

Through RuntimeService:

```text
inspect
get TargetReference
click
```

Verify:

```text
ActionResult.sessionId = ses_...
```

not:

```text
browser_...
```

Verify:

```text
agent_clicked
```

persisted.

---

# 83. Runtime Type Test

Type:

```text
"DO_NOT_PERSIST_THIS_VALUE"
```

Then search:

```text
.rove/
```

for that exact string.

Expected:

```text
zero matches
```

This is mandatory.

---

# 84. Runtime Serialization Test

Launch two mutation promises for the same session.

Instrument deterministic fixture so order is observable.

Verify second mutation begins only after first completes.

Reuse existing `BrowserCommandCoordinator`.

---

# 85. Cross-Session Serialization Test

Two different session IDs should not block one another.

The coordinator is per session, not global.

---

# 86. Control Test

Set/construct session with:

```text
controller = human
```

Agent click/type/navigation:

```text
CONTROL_NOT_OWNED
```

No browser mutation occurs.

---

# 87. Screenshot Persistence Test

Call runtime screenshot.

Verify returned:

```text
Evidence
```

Verify PNG exists under:

```text
evidence/screenshots/
```

Verify:

```text
screenshot_captured
```

observation exists.

Verify no caller path was accepted.

---

# 88. Record Evidence Test

Save:

```json
{
  "title": "Senior Backend Engineer",
  "company": "Example"
}
```

Verify record survives runtime service recreation/restart.

---

# 89. Observation Persistence Test

Perform:

```text
navigate
inspect
type
click
screenshot
```

Inspect JSONL.

Verify:

* sequence monotonically increases;
* inspect does not create noise entry;
* type observation contains no typed value;
* screenshot observation references evidence ID.

---

# 90. Session End Test

End session.

Verify:

```text
browser closed
BrowserService mapping removed
status = completed
controller = null
endedAt exists
session_completed appended
```

Second end:

```text
SESSION_ALREADY_ENDED
```

---

# 91. Historical Read Test

After end:

```text
getSession
getObservations
listEvidence
```

still work.

Live:

```text
inspectBrowser
navigate
click
```

must not work.

---

# 92. HTTP API Tests

Use Nest test application or normal integration tests.

Required:

```text
POST session
GET session
navigate
inspect
click
type
pages
screenshot
observations
evidence
end
```

Verify structured error filter.

---

# 93. Runtime Authentication Tests

With runtime token configured:

No header:

```text
401
```

Wrong token:

```text
401
```

Correct bearer token:

```text
request succeeds
```

Health without token:

```text
succeeds
```

Verify token never appears in logs/test snapshots.

---

# 94. Non-Loopback Safety Test

Configuration:

```text
host = 0.0.0.0
token = undefined
```

Expected startup/config failure:

```text
INVALID_CONFIGURATION
```

---

# 95. M4 Manual Verification

Add:

```bash
pnpm runtime:demo
```

The demo should use the actual runtime HTTP API.

It must not call `BrowserSession` directly.

Start runtime with deterministic home:

```bash
ROVE_HOME=.rove-demo pnpm dev:runtime
```

Then manual script executes:

```text
POST session
 ↓
real browser opens
 ↓
navigate fixture
 ↓
inspect
 ↓
extract target ref
 ↓
type
 ↓
click
 ↓
screenshot
 ↓
save record
 ↓
read observations
 ↓
end session
```

Print key IDs:

```text
session: ses_...
page: page_01
target: t...
evidence: ev_...
```

After completion tell tester to inspect:

```text
.rove-demo/sessions/<session-id>/
```

---

# 96. M4 Manual Filesystem Verification

Tester must visibly find:

```text
session.json
observations.jsonl
evidence/
```

Screenshot:

```text
evidence/screenshots/*.png
```

Structured record:

```text
evidence/records/*
```

Session JSON must show:

```text
status = completed
controller = null
```

---

# 97. M4 Manual Sensitive-Value Verification

During runtime demo use a known temporary string:

```text
ROVE_TEST_SECRET_849291
```

Enter it into fixture password field.

After session ends:

```bash
grep -R "ROVE_TEST_SECRET_849291" .rove-demo
```

Expected:

```text
no output
```

This is a required manual acceptance test.

---

# 98. Files Expected to Change — M3

Primarily:

```text
packages/browser/src/playwright-browser-session.ts

packages/browser/src/targets/*
packages/browser/src/actions/*
packages/browser/src/mutations/*

packages/browser/src/fixtures/*

packages/browser/package.json
package.json
```

Small protocol changes only if needed for agreed timeout/request schemas.

---

# 99. Files Expected to Change — M4

Primarily:

```text
apps/runtime/src/runtime.service.ts
apps/runtime/src/app.module.ts

apps/runtime/src/browser/browser.service.ts

apps/runtime/src/session/session.service.ts

apps/runtime/src/api/
├── session.controller.ts
├── browser.controller.ts
├── observation.controller.ts
├── evidence.controller.ts
├── runtime-auth.guard.ts
└── rove-error.filter.ts

apps/runtime/src/evidence/evidence.service.ts
apps/runtime/src/observation/observation.service.ts

packages/protocol/src/runtime.ts
packages/protocol/src/types.ts
packages/protocol/src/schemas.ts

packages/storage/src/interfaces.ts
packages/storage/src/filesystem.ts
packages/storage/src/paths.ts

README.md
docs/architecture.md
```

Do not broadly rewrite these files if small changes suffice.

---

# 100. Required Implementation Order

Execute exactly in this order.

## M3

### Step 1

Implement shared target resolver.

Test:

```text
valid
missing
stale
ambiguous
hidden
disabled
```

### Step 2

Implement material mutation tracker.

Test replaced vs unrelated mutation.

### Step 3

Implement click.

### Step 4

Implement type with sensitive-value guarantees.

### Step 5

Implement press.

### Step 6

Implement scroll.

### Step 7

Implement back/forward.

### Step 8

Implement screenshots and visual sensitive masking.

### Step 9

Implement shared action state synchronization.

### Step 10

Expand deterministic fixtures.

### Step 11

Complete M3 tests.

### Step 12

Add:

```text
pnpm browser:actions
```

Manually verify.

Do not start M4 until M3 browser tests are green.

---

# 101. M4 Implementation Order

### Step 13

Replace runtime DI binding:

```text
NotImplementedBrowserEngine
```

with:

```text
PlaywrightBrowserEngine
```

### Step 14

Refactor SessionService start state to:

```text
starting
```

### Step 15

Make RuntimeService start real browser.

Handle successful/failed lifecycle.

### Step 16

Normalize browser ActionResult IDs to Rove session IDs.

### Step 17

Expand `RoveRuntime` browser application interface.

### Step 18

Wire every browser action through existing command coordinator + control guard.

### Step 19

Persist action observations.

### Step 20

Synchronize `activePageId`.

### Step 21

Implement screenshot → Evidence persistence.

### Step 22

Complete evidence list/read operations.

### Step 23

Add browser/observation/evidence HTTP controllers.

### Step 24

Add runtime bearer guard behavior and error filter.

### Step 25

Fix session end ordering/lifecycle.

### Step 26

Complete runtime integration tests.

### Step 27

Add:

```text
pnpm runtime:demo
```

### Step 28

Perform manual filesystem and secret grep verification.

### Step 29

Run full repository gates.

### Step 30

Update docs only for implemented behavior.

Stop.

Do not start MCP.

---

# 102. Quality Gates

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
pnpm browser:actions
```

and:

```bash
pnpm runtime:demo
```

Both must pass.

---

# 103. Explicitly Out of Scope

Do not implement:

```text
MCP stdio
MCP HTTP
MCP authentication

Electron

human handoff UI
human event instrumentation
Capture Mode observation

persistent Chrome profiles
existing Chrome profile support

cloud execution
remote browser streaming

database
Redis
queues

arbitrary CSS selector APIs
arbitrary JavaScript

LLM reasoning
automatic stale-target recovery
automatic task reasoning
```

---

# 104. Decision Summary

There are no open implementation decisions for M3/M4.

Target execution:

```text
TargetRegistry
+
internal Rove DOM marker
+
fresh action-time semantic verification
```

No selector guessing.

Mutation strategy:

```text
lightweight material MutationObserver
+
action-time verification
```

Do not invalidate on every DOM mutation.

Click:

```text
locator.click()
force=false
```

Type:

```text
locator.fill(value)
```

Press:

```text
locator.press()
or page.keyboard.press()
```

Scroll:

```text
page.mouse.wheel()
default 600px
```

Back/forward:

```text
domcontentloaded
30s navigation timeout
no-history = successful no-op
```

Action timeout:

```text
10s
```

Screenshot:

```text
PNG bytes
viewport/full-page/target
sensitive visual masking
```

Runtime browser implementation:

```text
PlaywrightBrowserEngine
```

Runtime session:

```text
starting
→ active
→ completed/failed
```

Runtime browser map:

```text
existing BrowserService Map<sessionId, BrowserSession>
```

Concurrency:

```text
existing BrowserCommandCoordinator
one mutation at a time per session
```

Control:

```text
existing ControlService
agent mutation only when controller=agent
```

Runtime ActionResult:

```text
always uses ses_* runtime ID externally
```

Observations:

```text
append-only
monotonic
no raw typed values
```

Screenshots:

```text
Artifact inside browser package
→ Evidence at runtime boundary
```

Persistence:

```text
filesystem only
```

Private API:

```text
loopback default
/runtime token optional on loopback
required for non-loopback
```

HTTP controllers:

```text
thin adapters only
```

Testing:

```text
Vitest
deterministic local fixture
no third-party test dependency
```

MCP:

```text
explicitly deferred to M5
```

This runbook is the implementation authority for Milestones 3 and 4.
