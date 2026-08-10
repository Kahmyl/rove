# Rove — Milestones 1 & 2 Implementation Runbook

## Purpose

This document is the authoritative implementation runbook for:

- **Milestone 1 — Real Browser Lifecycle**
- **Milestone 2 — Semantic Inspection & Target References**

The implementation agent should execute this plan directly.

Do not redesign the architecture.

Do not perform broad repository exploration.

Do not reconsider decisions already specified here.

Do not implement Milestone 3 browser actions beyond what is minimally required to satisfy the existing `BrowserSession` interface.

The goal at the end of these two milestones is:

```text
start browser
    ↓
visible Chrome/Chromium
    ↓
register pages
    ↓
navigate page
    ↓
inspect page
    ↓
return semantic text + actionable targets
    ↓
return short-lived TargetReference values
```

The browser is not yet expected to execute target-based `click`, `type`, or similar interactions. Those belong to Milestone 3.

---

# 1. Existing Architecture — Do Not Change

The repository already contains:

```text
apps/
├── companion
├── mcp
└── runtime

packages/
├── browser
├── config
├── protocol
└── storage
```

For Milestones 1–2, almost all implementation belongs in:

```text
packages/browser
```

Small protocol changes are allowed only where this plan explicitly requires them.

Do not move Playwright into:

```text
apps/runtime
apps/mcp
apps/companion
```

`packages/browser` remains the only Playwright implementation boundary.

---

# 2. Existing Contracts — Preserve Them

The existing browser contract is authoritative:

```ts
export interface BrowserSession {
  readonly id: string;

  inspect(options?: InspectOptions): Promise<PageInspection>;

  navigate(url: string): Promise<ActionResult>;

  click(target: TargetReference): Promise<ActionResult>;

  type(target: TargetReference, value: string): Promise<ActionResult>;

  press(target: TargetReference | null, key: string): Promise<ActionResult>;

  scroll(options: ScrollOptions): Promise<ActionResult>;

  back(): Promise<ActionResult>;

  forward(): Promise<ActionResult>;

  screenshot(options?: ScreenshotOptions): Promise<Artifact>;

  pages(): Promise<PageSummary[]>;

  switchPage(pageId: string): Promise<PageSummary>;

  closePage(pageId: string): Promise<void>;

  invalidateTargets(): Promise<void>;

  close(): Promise<void>;
}

export interface BrowserEngine {
  start(config: BrowserLaunchConfig): Promise<BrowserSession>;
}
```

Do not replace this interface.

Do not expose Playwright `Page`, `Browser`, `BrowserContext`, `Locator`, or `ElementHandle` through protocol/public APIs.

---

# 3. Existing Protocol — Preserve Unless Explicitly Changed

These existing types are already suitable:

```ts
interface PageInspection {
  pageId: string;
  revision: number;
  url: string;
  title: string;

  viewport?: {
    width: number;
    height: number;
  };

  text?: string;

  targets?: PageTarget[];

  metadata?: Record<string, unknown>;
}
```

```ts
interface PageTarget {
  ref: string;
  kind: TargetKind;
  role?: string;
  name?: string;
  visible: boolean;
  enabled: boolean;
  sensitive?: boolean;
}
```

```ts
interface TargetReference {
  pageId: string;
  revision: number;
  ref: string;
}
```

```ts
interface InspectOptions {
  includeText?: boolean;
  includeTargets?: boolean;
  includeViewport?: boolean;
  maxTextChars?: number;
  targetLimit?: number;
  targetKinds?: TargetKind[];
  pageId?: string;
}
```

No new public inspection model should be invented for Milestones 1–2.

---

# 4. Existing Supporting Classes — Extend, Do Not Replace

Existing:

```text
packages/browser/src/pages/page-state.ts
packages/browser/src/pages/page-registry.ts

packages/browser/src/targets/target-identity.ts
packages/browser/src/targets/target-registry.ts
```

Reuse these.

`PageState` already separates:

```text
revision
mutationVersion
```

Maintain that distinction.

`TargetRegistry` already handles:

```text
pageId
revision
t1 / t2 / t3 references
stale revision validation
target invalidation
```

Do not create a competing target reference mechanism.

---

# 5. Milestone Boundaries

## Milestone 1 delivers

```text
Playwright browser launch
headed browser
Chrome preference
Chromium fallback
temporary profile/session
BrowserContext
Page registration
stable session-local page IDs
active-page tracking
navigation
page listing
page switching
page closing
browser shutdown
```

## Milestone 2 delivers

```text
semantic inspect()
page text extraction
viewport metadata
interactive target discovery
accessible role/name information
TargetIdentity generation
TargetRegistry population
TargetReference generation
sensitive target classification
inspection filters/limits
deterministic fixtures
```

## Milestone 3 does NOT belong here

Do not fully implement:

```text
click(target)
type(target)
press(target)
scroll(...)
back()
forward()
screenshot(...)
target re-resolution
material DOM mutation invalidation
stale element execution handling
```

These methods must remain explicit `NOT_IMPLEMENTED` failures where necessary.

The only exception is `navigate()`, because navigation is necessary to manually verify Milestones 1–2.

---

# 6. Files to Add

Create:

```text
packages/browser/src/playwright-browser-engine.ts

packages/browser/src/playwright-browser-session.ts

packages/browser/src/pages/playwright-page-registry.ts

packages/browser/src/inspection/
├── inspector.ts
├── target-discovery.ts
├── text-extractor.ts
└── dom-types.ts

packages/browser/src/fixtures/
├── fixture-server.ts
└── pages/
    └── inspection.html

packages/browser/src/playwright-browser-engine.test.ts
packages/browser/src/inspection/inspector.test.ts
```

A slightly different internal file split is acceptable only if it preserves the responsibilities described here.

Do not create additional abstraction layers unless they remove actual duplication.

---

# 7. Files to Modify

Expected modifications:

```text
packages/browser/src/index.ts

packages/browser/src/pages/page-registry.ts
packages/browser/src/pages/page-state.ts

packages/browser/src/targets/target-registry.ts
packages/browser/src/targets/target-identity.ts

packages/browser/package.json

README.md
docs/architecture.md
```

Modify protocol files only if a compile-time requirement is encountered that cannot be satisfied by the existing types.

Do not broadly rewrite protocol contracts.

---

# 8. Milestone 1 — Playwright Browser Engine

## 8.1 Replace the Placeholder

Keep:

```text
NotImplementedBrowserEngine
```

only if existing tests or other code still need it.

Add and export:

```ts
export class PlaywrightBrowserEngine
  implements BrowserEngine
```

`PlaywrightBrowserEngine.start()` must return a real `BrowserSession`.

---

# 9. Browser Selection Strategy

This is fixed.

Given:

```ts
BrowserLaunchConfig;
```

apply the following rules.

## Rule 1 — executablePath supplied

When:

```ts
config.executablePath;
```

is defined:

Use Playwright Chromium with that explicit executable.

Do not perform browser discovery.

---

## Rule 2 — browser = "chromium"

Use Playwright bundled Chromium:

```ts
chromium.launch(...)
```

No Chrome probing.

---

## Rule 3 — browser = "chrome"

Attempt system Google Chrome first:

```ts
chromium.launch({
  channel: "chrome",
  ...
})
```

If Chrome launch fails specifically because the Chrome executable/channel is unavailable:

fallback once to:

```ts
chromium.launch(...)
```

using bundled Chromium.

Do not fallback for arbitrary runtime errors after Chrome has successfully started.

Do not recursively retry.

Do not implement OS-specific browser registry discovery.

Playwright's `channel: "chrome"` is the Chrome discovery mechanism.

---

# 10. Headed/Headless Behavior

Honor:

```ts
config.headless;
```

exactly.

Do not silently force headed mode inside the engine.

Product-level/default configuration will normally pass:

```text
headless = false
```

but the browser package remains reusable and honors its supplied configuration.

---

# 11. Temporary Profile Strategy

Milestone 1 supports:

```ts
{
  mode: "temporary";
}
```

as the working profile mode.

Use:

```text
browser launch
    ↓
browser.newContext()
```

for temporary sessions.

Do not manually create a Chrome user-data directory for temporary mode.

Playwright/browser lifecycle is responsible for ephemeral process state.

---

# 12. Persistent / Existing Profiles

The public protocol already supports:

```text
persistent
existing
```

but they are not Milestone 1 acceptance requirements.

For these two modes in this milestone:

Return a structured:

```text
NOT_IMPLEMENTED
```

error with a clear message.

Do not silently treat them as temporary.

Do not partially implement persistent profiles.

They will receive their own implementation slice later.

---

# 13. Browser Context Configuration

Create one browser context per `BrowserSession`.

Apply:

```ts
config.viewport;
```

when supplied.

When not supplied, use:

```text
1440 x 900
```

for deterministic development/test behavior.

Do not create multiple contexts per Rove browser session.

---

# 14. Browser Session ID

Generate an opaque session-local browser identifier:

```text
browser_<uuid>
```

or:

```text
browser_<random-id>
```

The exact random implementation is internal.

Requirements:

- unique enough for local process usage;
- not based on incrementing global process state;
- never use the Rove runtime `ses_*` namespace.

This is the `BrowserSession.id`.

---

# 15. Initial Page

After creating the BrowserContext:

1. create exactly one initial page;
2. register it;
3. make it the active page;
4. assign:

```text
page_01
```

through existing `PageRegistry`.

Initial URL may be:

```text
about:blank
```

---

# 16. Playwright Page Mapping

The existing `PageRegistry` tracks Rove metadata but does not hold Playwright `Page` objects.

Do not put Playwright types into `PageState`.

Maintain the Playwright mapping inside the browser package/session.

Use:

```ts
Map<string, Page>;
```

and:

```ts
WeakMap<Page, string>;
```

or equivalent.

Requirements:

```text
Rove page ID → Playwright Page
Playwright Page → Rove page ID
```

must both be resolvable.

This mapping remains private to `packages/browser`.

---

# 17. Registering New Pages

Subscribe to BrowserContext page creation.

For every page not already registered:

1. assign next `page_XX`;
2. create PageState;
3. store Playwright mapping;
4. subscribe to relevant page lifecycle events.

New pages do not require semantic observations yet.

---

# 18. Active Page Semantics

The active Rove page is:

1. the initial page at session start;
2. a page explicitly selected through `switchPage()`;
3. a newly opened popup/page when it is created by the currently active page.

When a new page appears, activate it.

This gives expected browser-agent behavior for links that open new tabs.

Do not attempt OS/window focus detection.

Rove's active page is application state, not physical window-focus state.

---

# 19. Page Lifecycle Listeners

Attach listeners required to maintain metadata.

At minimum:

```text
framenavigated for main frame
domcontentloaded/load where useful
close
```

Update:

```text
url
title
```

after navigation/load.

Do not implement the full Milestone 3 mutation observer yet.

---

# 20. Page Revision in Milestone 1

Initial page:

```text
revision = 0
```

On successful main-frame navigation:

increment the page revision by exactly 1.

Also increment `mutationVersion`.

Use existing:

```ts
recordMutation(state, true);
```

or equivalent existing helper.

Do not introduce another revision counter.

This allows Milestone 2 target references to belong to a specific navigated document.

---

# 21. navigate()

Implement now.

Behavior:

```ts
navigate(url);
```

operates on the active page.

Use Playwright:

```text
page.goto(url)
```

Wait condition:

```text
domcontentloaded
```

Do not wait for `networkidle`.

Modern websites may never become network-idle.

Default timeout:

```text
30 seconds
```

unless existing configuration already supplies a browser timeout.

Successful result must follow existing `ActionResult`.

Because the browser package does not own a Rove runtime session ID yet, use the browser session ID in the existing required `sessionId` field for Milestones 1–3.

Runtime integration may later map/replace this at its boundary.

Result:

```ts
{
  ok: true,
  action: "navigate",
  sessionId: browserSession.id,
  pageId,
  pageChanged: true,
  previousRevision,
  currentRevision,
  url
}
```

Do not modify the public `ActionResult` contract in these milestones.

---

# 22. pages()

Return existing:

```ts
PageSummary[]
```

from `PageRegistry.summaries()`.

Before returning, synchronize easily available URL/title values from Playwright pages.

Do not perform expensive page inspection.

---

# 23. switchPage()

Input:

```text
pageId
```

Behavior:

1. verify page exists;
2. verify Playwright Page is not closed;
3. activate via `PageRegistry`;
4. call `page.bringToFront()`;
5. return PageSummary.

Unknown page:

```text
PAGE_NOT_FOUND
```

---

# 24. closePage()

Behavior:

1. reject unknown page with `PAGE_NOT_FOUND`;
2. close corresponding Playwright Page;
3. remove mappings;
4. remove PageRegistry entry.

If the active page closes:

- activate the most recently registered remaining page;
- if no pages remain, create a fresh `about:blank` page and register it.

A live `BrowserSession` must always have an active page until `close()` begins.

---

# 25. close()

Must be idempotent.

First call:

```text
close BrowserContext
close Browser
clear registries/maps
mark session closed
```

Subsequent calls:

```text
no-op
```

Methods requiring an open browser after closure should throw:

```text
BROWSER_CLOSED
```

Do not expose raw Playwright "Target page/context/browser has been closed" messages as the primary error contract.

---

# 26. Remaining BrowserSession Methods in Milestone 1

Until Milestone 3, these methods should throw structured `NOT_IMPLEMENTED`:

```text
click
type
press
scroll
back
forward
screenshot
```

`inspect()` is implemented in Milestone 2.

`invalidateTargets()` should be implemented once TargetRegistry is connected in Milestone 2.

Do not fake successful action responses.

---

# 27. Milestone 1 Tests

Use Vitest.

Do not use external websites for automated acceptance.

Start a local fixture server.

Required tests:

### Browser starts

```text
start temporary session
expect real page_01
expect active = true
expect about:blank
```

### Chromium launch

Explicit:

```text
browser = chromium
```

must work in CI/development with installed Playwright browser.

### Navigation

Navigate to local fixture.

Verify:

```text
URL changed
pageId unchanged
revision increased
```

### pages()

Verify initial page returned.

### New page registration

Create/open popup fixture.

Verify:

```text
page_02 exists
page_02 active
```

### switchPage()

Switch to `page_01`.

Verify:

```text
page_01 active
page_02 inactive
```

### closePage()

Close page and verify registry.

### close()

Call twice.

Must not throw second time.

### closed operation

After close:

```text
navigate(...)
```

returns/throws structured:

```text
BROWSER_CLOSED
```

---

# 28. Milestone 1 Manual Verification Command

Add a root or browser-package script:

```bash
pnpm browser:demo
```

Preferred root package script:

```json
"browser:demo": "pnpm --filter @rove/browser demo"
```

Add the package-level script and a small executable TypeScript demo.

The demo must:

1. launch headed browser;
2. start local fixture server;
3. navigate to fixture;
4. print page ID;
5. print URL;
6. print page summaries;
7. keep browser open long enough for manual inspection or wait for Enter;
8. close cleanly.

Expected visible behavior:

```text
Chrome/Chromium opens
fixture page appears
terminal shows page_01 and fixture URL
Enter closes browser cleanly
```

Do not use `example.com` for the canonical verification.

Use the deterministic local fixture.

---

# 29. Milestone 2 — Semantic Inspection

Milestone 2 builds on the real Playwright session.

The core implementation is:

```text
Playwright Page
      ↓
Inspector
      ├── text extraction
      └── target discovery
              ↓
       TargetRegistry
              ↓
       PageInspection
```

---

# 30. Inspection Architecture

Create:

```ts
class PageInspector
```

or equivalent.

Responsibility:

```ts
inspect(
  page: Page,
  pageState: PageState,
  options: InspectOptions,
  targetRegistry: TargetRegistry<...>
): Promise<PageInspection>
```

Do not place large DOM extraction code directly inside `PlaywrightBrowserSession.inspect()`.

Browser session coordinates.

Inspector extracts.

TargetRegistry owns target references.

---

# 31. Default Inspect Options

Resolve omitted options to:

```ts
{
  includeText: true,
  includeTargets: true,
  includeViewport: true,
  maxTextChars: 20_000,
  targetLimit: 200
}
```

`targetKinds` defaults to no filtering.

`pageId` defaults to active page.

These defaults are fixed for Milestone 2.

---

# 32. Selecting Page for Inspection

When:

```ts
options.pageId;
```

exists:

inspect exactly that page.

Otherwise inspect the active page.

Unknown page:

```text
PAGE_NOT_FOUND
```

Closed page:

```text
PAGE_NOT_FOUND
```

Do not automatically change the active page merely because another page was inspected.

---

# 33. Synchronize Page State Before Inspection

Immediately before inspection:

update PageState with:

```text
page.url()
await page.title()
```

Viewport comes from:

```text
page.viewportSize()
```

If viewport is unavailable, omit it.

---

# 34. Text Extraction Strategy

Use one browser-context DOM evaluation for visible meaningful page text.

Do not:

- serialize HTML;
- return `document.documentElement.outerHTML`;
- return hidden text;
- return script/style content;
- inspect every DOM attribute;
- use screenshots/OCR.

Text source:

```text
document.body.innerText
```

Normalize:

1. convert CRLF to LF;
2. trim line whitespace;
3. collapse more than two consecutive blank lines;
4. trim final output;
5. truncate to `maxTextChars`.

If truncation occurs, set:

```ts
metadata.textTruncated = true;
```

Otherwise:

```ts
metadata.textTruncated = false;
```

Do not attempt semantic summarization.

The external agent will reason about the text.

---

# 35. Target Discovery Strategy

Perform target discovery in a single page evaluation pass.

Do not issue one Playwright locator query per element.

The aim is:

```text
one DOM traversal
+
compact serialized candidate descriptions
```

Candidate selector set:

```css
a[href],
button,
input:not([type="hidden"]),
textarea,
select,
[role],
[contenteditable="true"],
[tabindex]
```

Only `[role]` and `[tabindex]` candidates that represent plausible interaction controls should survive classification.

Do not return arbitrary generic containers merely because they have `tabindex="-1"`.

---

# 36. Supported Target Kinds

Map to the existing protocol kinds:

```text
button
link
input
textarea
select
checkbox
radio
tab
menuitem
option
control
```

Classification order is fixed.

### Native elements

```text
a[href]             → link
button              → button
textarea            → textarea
select              → select
input[type=checkbox]→ checkbox
input[type=radio]   → radio
other input         → input
option              → option
```

### ARIA roles

```text
role=button         → button
role=link           → link
role=checkbox       → checkbox
role=radio          → radio
role=tab            → tab
role=menuitem       → menuitem
role=option         → option
```

Other interactive ARIA roles:

```text
control
```

### Contenteditable

```text
control
```

unless a stronger semantic classification applies.

---

# 37. Allowed Interactive ARIA Roles

Treat these as interactive:

```text
button
link
checkbox
radio
tab
menuitem
menuitemcheckbox
menuitemradio
option
combobox
listbox
textbox
searchbox
slider
spinbutton
switch
treeitem
```

Map unsupported specific kinds to:

```text
control
```

Do not expose structural roles such as:

```text
heading
article
navigation
main
row
cell
list
listitem
```

as targets merely because they have a role.

---

# 38. Visibility

A candidate is visible only when all are true:

- connected to document;
- computed `display !== "none"`;
- computed `visibility !== "hidden"`;
- computed `visibility !== "collapse"`;
- opacity is not zero where practical;
- bounding rectangle has positive width and height.

Hidden candidates should not appear in the target output.

Set:

```text
visible = true
```

for returned targets.

There is no reason in Milestone 2 to return ordinary hidden targets with `visible=false`.

---

# 39. Enabled State

Determine disabled state from:

```text
native `disabled`
aria-disabled="true"
```

Returned target may remain present with:

```text
enabled = false
```

Do not omit disabled visible controls.

This allows the agent to understand that the control exists but cannot currently be used.

---

# 40. Accessible Name Strategy

Name resolution order:

1. `aria-label`;
2. referenced text from `aria-labelledby`;
3. associated `<label for=...>`;
4. wrapping `<label>`;
5. `alt` for relevant image/input controls;
6. `title`;
7. `placeholder` for text inputs when no stronger name exists;
8. visible element text;
9. `value` for button-like input controls.

Normalize whitespace.

Limit exposed target name to:

```text
500 characters
```

Do not add an accessibility dependency for Milestone 2.

Do not implement the entire W3C Accessible Name algorithm.

This approximation is the V1 target-discovery strategy.

---

# 41. Target Identity

For each returned candidate construct internal:

```ts
TargetIdentity;
```

using available values:

```text
role
name
tag
type
text
id
testId
attributes
domPathHint
```

Only retain useful attributes.

Allowed stored attribute hints:

```text
name
autocomplete
aria-label
aria-labelledby
aria-disabled
href
placeholder
data-testid
```

Do not copy every DOM attribute.

---

# 42. testId

Resolve test ID from:

```text
data-testid
```

only.

Do not support a configurable list of test-id attribute names in Milestone 2.

---

# 43. domPathHint

Use a simple deterministic structural hint.

Example:

```text
html>body>main>form>button:nth-of-type(1)
```

This is an identity hint only.

It is not exposed as an agent selector.

Do not build a sophisticated unique CSS selector generator.

Milestone 3 may use this as one signal during target re-resolution.

---

# 44. Sensitive Target Classification

Reuse existing:

```ts
isSensitiveTarget(identity);
```

Do not create another sensitivity classifier.

It already covers:

```text
password
current-password
new-password
one-time-code
password/passcode/otp/secret/token semantic names
```

Expose:

```ts
sensitive: true;
```

on `PageTarget` when applicable.

Never extract current input values as part of target inspection.

---

# 45. Browser-Side Candidate IDs

Target discovery must return a way to associate the serialized candidate with the actual DOM node for the current inspection.

Do not use CSS selectors as the public identity.

Recommended Milestone 2 implementation:

During inspection, assign an ephemeral internal DOM marker:

```text
data-rove-target="<inspection-local-id>"
```

to discovered target nodes.

Example:

```text
data-rove-target="r1"
data-rove-target="r2"
```

Then the internal TargetRegistry handle may be:

```ts
{
  page: Page,
  marker: "r1"
}
```

or a Playwright Locator created from that marker.

The marker is internal only.

Before a new inspection on the same page:

remove previous:

```text
data-rove-target
```

markers created by Rove.

Then create fresh markers.

Do not expose `data-rove-target` through `PageTarget`.

Do not use `ElementHandle` as a long-lived cross-inspection identity.

This marker exists only to bridge Milestone 2 inspection into Milestone 3 resolution.

---

# 46. TargetRegistry Lifetime

Maintain exactly one active `TargetRegistry` per registered Rove page.

Structure conceptually:

```ts
Map<string, TargetRegistry<TargetHandle>>;
```

where key is `pageId`.

Before each new inspection of a page:

```text
create/reset TargetRegistry using current page revision
```

Fresh inspection produces:

```text
t1
t2
t3
...
```

for that page/revision.

It is acceptable for target refs to restart from `t1` after a new inspection because the full identity is:

```text
pageId + revision + ref
```

Milestone 3 will tighten behavior around same-revision repeated inspections if required.

For these milestones, a new inspection invalidates the previous TargetRegistry for that page.

---

# 47. inspect() Result Construction

For each discovered target:

register:

```ts
targetRegistry.register(identity, internalHandle);
```

Return:

```ts
{
  ref: registered.reference.ref,
  kind,
  role,
  name,
  visible: true,
  enabled,
  sensitive
}
```

The `TargetReference` used later by actions is reconstructed as:

```ts
{
  pageId: inspection.pageId,
  revision: inspection.revision,
  ref: target.ref
}
```

Do not change public `PageTarget.ref` into a nested TargetReference.

The current compact format is intentional.

---

# 48. targetLimit

Apply after:

- candidate classification;
- visibility filtering;
- targetKinds filtering.

Keep DOM order.

Return at most:

```text
targetLimit
```

targets.

Set:

```ts
metadata.targetsTruncated = true;
```

when additional eligible targets existed.

Otherwise false.

Do not implement pagination yet.

---

# 49. targetKinds Filtering

When:

```ts
targetKinds;
```

is supplied:

only include matching target kinds.

Example:

```ts
{
  targetKinds: ["button", "link"];
}
```

must exclude inputs/selects/etc.

Text extraction remains unaffected.

---

# 50. includeText

When:

```text
includeText = false
```

omit the `text` property entirely.

Do not return:

```text
text: ""
```

unless the real visible body text is empty and text was requested.

---

# 51. includeTargets

When:

```text
includeTargets = false
```

omit `targets`.

Also avoid running target discovery entirely.

Do not perform work whose result will be discarded.

---

# 52. includeViewport

When:

```text
includeViewport = false
```

omit viewport.

---

# 53. Inspection Metadata

Milestone 2 metadata should be small and deterministic.

Allowed keys:

```ts
{
  textTruncated?: boolean,
  targetsTruncated?: boolean
}
```

Do not dump DOM metadata, timing traces, Playwright internals, or debugging structures.

---

# 54. Page Revision During Inspection

Inspection itself does not increment revision.

```text
inspect()
inspect()
inspect()
```

without material page change should preserve the page revision.

Do not treat a Rove-injected `data-rove-target` marker as a page mutation.

Rove's own inspection instrumentation must not invalidate Rove's page references.

---

# 55. Mutation Observation — Explicitly Deferred

Do not add a general `MutationObserver` in Milestone 2.

The only revision changes required for Milestones 1–2 are:

```text
main-frame navigation/document change
explicit invalidateTargets()
```

Full material DOM mutation detection belongs to Milestone 3 because that is where stale-action correctness becomes relevant.

This avoids unnecessary complexity now.

---

# 56. invalidateTargets()

Implement:

```ts
BrowserSession.invalidateTargets();
```

against the active page.

Behavior:

1. increment that page's revision as material;
2. invalidate its TargetRegistry with new revision;
3. remove Rove DOM target markers.

This will later be used by human-agent handoff.

No other page is invalidated.

---

# 57. Fixture Page

Create deterministic inspection fixture with all of these:

```html
<h1>Rove Inspection Fixture</h1>

<p>Visible fixture description</p>

<a href="/next">View details</a>

<button id="submit">Submit</button>

<label for="search">Search jobs</label>
<input id="search" type="text" />

<input id="password" type="password" autocomplete="current-password" />

<label>
  <input type="checkbox" />
  Remote only
</label>

<select aria-label="Sort results">
  <option>Newest</option>
  <option>Oldest</option>
</select>

<button disabled>Disabled action</button>

<button style="display:none">Hidden action</button>

<div role="button" tabindex="0">Custom action</div>

<div role="heading">Structural role</div>
```

Also include enough visible text to test truncation.

Do not rely on a third-party site.

---

# 58. Fixture Server

Implement a tiny Node HTTP fixture server.

Do not add Express/Fastify/NestJS.

Use:

```text
node:http
```

Requirements:

- bind to `127.0.0.1`;
- use ephemeral port `0`;
- return actual chosen port;
- serve fixture HTML;
- expose cleanup function;
- usable by tests and manual demos.

Do not create a separate test application.

---

# 59. Milestone 2 Required Tests

## Basic page metadata

Verify:

```text
pageId
revision
url
title
viewport
```

---

## Visible text

Verify:

```text
Rove Inspection Fixture
Visible fixture description
```

appears.

Hidden text should not appear when hidden via normal CSS `display:none`.

---

## Link

Expected:

```text
kind = link
name = View details
```

---

## Native button

Expected:

```text
kind = button
name = Submit
enabled = true
```

---

## Labeled input

Expected:

```text
kind = input
name = Search jobs
```

---

## Sensitive input

Password input:

```text
kind = input
sensitive = true
```

Never inspect/store its value.

---

## Checkbox

Expected:

```text
kind = checkbox
name = Remote only
```

---

## Select

Expected:

```text
kind = select
name = Sort results
```

---

## Disabled control

Must be returned:

```text
enabled = false
```

---

## Hidden control

Must not be returned.

---

## Custom role button

Expected:

```text
kind = button
name = Custom action
```

---

## Structural role

`role=heading` must not become a target.

---

## Unique refs

Targets in one inspection:

```text
t1
t2
...
```

must be unique.

---

## Target registry relationship

Every exposed target ref must resolve inside the page's current TargetRegistry.

---

## text limit

Set:

```text
maxTextChars = 50
```

Verify:

```text
text.length <= 50
metadata.textTruncated = true
```

---

## target limit

Set:

```text
targetLimit = 2
```

Verify:

```text
targets.length = 2
metadata.targetsTruncated = true
```

---

## target kind filter

Inspect with:

```text
targetKinds = ["button"]
```

Verify no links/inputs/selects.

---

## omitted sections

Verify:

```text
includeText = false
```

does not produce `text`.

Verify:

```text
includeTargets = false
```

does not produce `targets`.

Verify:

```text
includeViewport = false
```

does not produce `viewport`.

---

# 60. Milestone 2 Manual Demo

Add:

```bash
pnpm browser:inspect
```

Preferred root script:

```json
"browser:inspect": "pnpm --filter @rove/browser inspect-demo"
```

The demo must:

1. start fixture server;
2. launch headed browser;
3. navigate to fixture;
4. call `inspect()`;
5. print formatted inspection JSON;
6. keep browser visible until Enter;
7. cleanup.

Expected terminal output resembles:

```json
{
  "pageId": "page_01",
  "revision": 1,
  "url": "http://127.0.0.1:...",
  "title": "Rove Inspection Fixture",
  "viewport": {
    "width": 1440,
    "height": 900
  },
  "text": "...",
  "targets": [
    {
      "ref": "t1",
      "kind": "link",
      "role": "link",
      "name": "View details",
      "visible": true,
      "enabled": true
    },
    {
      "ref": "t2",
      "kind": "button",
      "role": "button",
      "name": "Submit",
      "visible": true,
      "enabled": true
    }
  ]
}
```

Exact `tN` ordering follows DOM order.

---

# 61. Exports

Update:

```text
packages/browser/src/index.ts
```

to export the real implementation and useful browser-domain classes.

At minimum:

```ts
export * from "./engine.js";
export * from "./playwright-browser-engine.js";
```

Export inspection classes only if they are useful to package consumers/tests.

Do not expose internal DOM candidate structures unnecessarily.

---

# 62. Default Engine Choice

Do not globally instantiate a browser engine in the package.

Consumers should construct:

```ts
new PlaywrightBrowserEngine();
```

Runtime wiring can choose this implementation in Milestone 4.

Keep:

```text
BROWSER_ENGINE
```

DI token unchanged.

---

# 63. Error Mapping

Translate expected Playwright lifecycle errors into `RoveError`.

Use existing codes where available:

```text
BROWSER_CLOSED
BROWSER_LAUNCH_FAILED
PAGE_NOT_FOUND
NAVIGATION_FAILED
ACTION_TIMEOUT
NOT_IMPLEMENTED
```

If `BROWSER_LAUNCH_FAILED` is already part of the error union, use it.

Do not throw plain strings.

Do not create arbitrary one-off error codes without checking the existing protocol error union.

Raw Playwright error may be included as a `cause` internally, but public message should be stable.

---

# 64. No Logging Framework Work

Milestones 1–2 do not introduce a logging framework.

Use minimal diagnostics in demo scripts.

Library implementation should not spam stdout.

Do not add Pino/Winston/etc.

Runtime observability is a later integration concern.

---

# 65. No New Dependencies Unless Required

Current browser package already depends on:

```text
playwright
@rove/protocol
```

These are sufficient.

Do not add:

- Cheerio;
- JSDOM;
- accessibility libraries;
- Express;
- browser-use libraries;
- Puppeteer;
- selector-generation libraries.

Use Playwright and the browser DOM directly.

---

# 66. Test Runner

Use existing:

```text
Vitest
```

Do not introduce Playwright Test as a second test runner.

Playwright is browser automation only.

Vitest remains the repository test framework.

---

# 67. TypeScript Style

Repository is ESM.

Internal imports must retain project convention:

```ts
import ... from "./file.js";
```

Do not convert packages to CommonJS.

Do not alter root TypeScript architecture.

---

# 68. Formatting / Quality Gates

Before considering either milestone complete, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

All must pass.

Do not finish with known failing tests justified as unrelated unless the failures demonstrably pre-existed.

---

# 69. Milestone 1 Definition of Done

Milestone 1 is complete only when all are true:

- [ ] `PlaywrightBrowserEngine` exists.
- [ ] Temporary session launches real browser.
- [ ] `headless` is honored.
- [ ] Chrome channel is preferred for `browser=chrome`.
- [ ] Chromium fallback works when Chrome is unavailable.
- [ ] explicit Chromium works.
- [ ] one BrowserContext exists per session.
- [ ] initial page is `page_01`.
- [ ] page IDs remain stable.
- [ ] navigation works.
- [ ] navigation increments revision.
- [ ] new pages are registered.
- [ ] active-page state works.
- [ ] switching pages works.
- [ ] closing pages works.
- [ ] closing session is idempotent.
- [ ] closed session operations produce `BROWSER_CLOSED`.
- [ ] unsupported browser actions explicitly produce `NOT_IMPLEMENTED`.
- [ ] automated browser lifecycle tests pass.
- [ ] `pnpm browser:demo` visibly works.
- [ ] repository lint/typecheck/test/build pass.

---

# 70. Milestone 2 Definition of Done

Milestone 2 is complete only when all are true:

- [ ] `inspect()` works against active page.
- [ ] explicit `pageId` inspection works.
- [ ] inspection returns page ID/revision/URL/title.
- [ ] viewport is returned by default.
- [ ] visible body text is returned by default.
- [ ] text is normalized and bounded.
- [ ] eligible interactive DOM elements are discovered.
- [ ] hidden controls are excluded.
- [ ] disabled controls remain visible with `enabled=false`.
- [ ] target kind mapping follows this document.
- [ ] accessible-name approximation follows this document.
- [ ] target identities are generated.
- [ ] existing sensitive-target classifier is reused.
- [ ] password fields are marked sensitive.
- [ ] no input values are extracted.
- [ ] one TargetRegistry exists per page.
- [ ] target refs are short `tN` references.
- [ ] refs are associated with current page revision.
- [ ] target limit works.
- [ ] target kind filtering works.
- [ ] includeText/includeTargets/includeViewport work.
- [ ] inspection itself does not increment revision.
- [ ] `invalidateTargets()` increments revision and clears refs.
- [ ] deterministic fixture exists.
- [ ] automated semantic inspection tests pass.
- [ ] `pnpm browser:inspect` visibly matches the fixture.
- [ ] repository lint/typecheck/test/build pass.

---

# 71. Required Implementation Order

Execute in this exact order.

## Step 1

Implement Playwright browser launch and temporary BrowserContext.

Verify browser visibly launches.

## Step 2

Connect Playwright pages to existing PageRegistry.

Verify:

```text
page_01
```

## Step 3

Implement active-page lifecycle.

Implement:

```text
pages
switchPage
closePage
```

## Step 4

Implement navigation and revision update.

Verify local fixture URL.

## Step 5

Write Milestone 1 automated tests.

## Step 6

Add `browser:demo`.

Manually verify.

## Step 7

Implement fixture server/page for semantic inspection.

## Step 8

Implement visible text extraction.

Test independently.

## Step 9

Implement one-pass target candidate discovery.

Test independently.

## Step 10

Implement target classification and accessible-name approximation.

Test independently.

## Step 11

Connect TargetIdentity and existing sensitivity classifier.

## Step 12

Connect per-page TargetRegistry.

Generate `tN` refs.

## Step 13

Implement inspect filtering/limits/defaults.

## Step 14

Implement `invalidateTargets()`.

## Step 15

Add complete Milestone 2 integration tests.

## Step 16

Add `browser:inspect`.

Manually compare browser UI against returned JSON.

## Step 17

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Step 18

Update README/architecture docs only to describe implemented behavior and manual verification commands.

Stop.

Do not begin Milestone 3.

---

# 72. Implementation Constraints

The implementation must not:

- redesign repository architecture;
- move browser logic into NestJS;
- move browser logic into MCP;
- add an LLM;
- add autonomous recovery;
- expose arbitrary CSS selectors;
- expose arbitrary JavaScript;
- implement generic selector generation;
- add browser extensions;
- add remote browser support;
- implement persistent profiles now;
- implement existing Chrome profiles now;
- implement general DOM mutation tracking now;
- implement target re-resolution now;
- implement MCP now;
- implement runtime session integration now;
- implement Electron changes;
- implement Capture Mode;
- add infrastructure unrelated to Milestones 1–2.

---

# 73. Decision Summary

There are no open architecture decisions for these milestones.

Use:

```text
Playwright Chromium API
```

Browser preference:

```text
explicit executablePath
    otherwise
browser=chrome → channel=chrome → bundled Chromium fallback
browser=chromium → bundled Chromium
```

Profile:

```text
temporary only for M1
```

Context:

```text
one BrowserContext per BrowserSession
```

Default viewport:

```text
1440 × 900
```

Page identity:

```text
existing PageRegistry
page_01, page_02...
```

Revision:

```text
existing PageState revision
navigation = material change
inspection = not a material change
```

Inspection text:

```text
document.body.innerText
normalized + bounded
```

Target extraction:

```text
single DOM-evaluation pass
```

Target names:

```text
small deterministic accessible-name approximation
```

Target identity:

```text
existing TargetIdentity
```

Sensitivity:

```text
existing isSensitiveTarget()
```

Target references:

```text
existing TargetRegistry
```

Target DOM bridging:

```text
ephemeral internal data-rove-target marker
```

Test framework:

```text
Vitest
```

Fixture server:

```text
node:http
127.0.0.1
ephemeral port
```

Manual acceptance:

```text
pnpm browser:demo
pnpm browser:inspect
```

Milestone 3 work:

```text
explicitly deferred
```

This plan is the implementation authority for Milestones 1 and 2.
