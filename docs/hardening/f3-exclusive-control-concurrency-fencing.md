# F3 — Exclusive Control & Concurrency Fencing

## Status

Architecture and invariant freeze for F3.

F3 begins after:

- F1 browser perception;
- F2 policy/orchestration separation;
- F4 browser/runtime fidelity.

F3 does not redesign those layers. It establishes exclusive ownership over all live browser access and makes ownership changes safe under concurrency.

## Mission

Make Rove's control-owner guarantee true for every live browser operation, not only mutations.

At any instant, exactly one actor may own live browser access through Rove.

When the agent does not own the browser, no agent-facing live browser operation may execute or return browser-derived state.

This includes:

- inspection;
- page enumeration;
- screenshots;
- navigation;
- clicking;
- typing;
- key presses;
- scrolling;
- history navigation;
- page switching;
- page closing;
- live page identity/freshness reads;
- any future agent-facing live browser capability.

Historical/session data that does not touch the live browser is not governed by the ownership fence.

## Existing gap

The post-F2 Runtime already protects mutation paths through `BrowserCommandCoordinator`, active-session checks, and mutation authorization.

However, `inspectBrowser()` and `pages()` currently require only an active session before accessing the live browser.

Therefore this sequence is currently possible in principle:

```text
agent owns browser
→ agent inspect is admitted
→ inspect waits on browser
→ human takeover starts/completes
→ inspect finishes
→ stale human-controlled browser state escapes to agent
```

Checking ownership only before starting an operation is therefore insufficient.

## Core concurrency invariant

A live browser operation is valid only when the ownership generation that authorized the operation is still current when that operation:

1. commits any Runtime state derived from the browser; and
2. returns any browser-derived result to its caller.

A stale-generation result must never be committed or returned.

In particular, a stale inspection must never be recorded into `InteractionPolicy`, because doing so could authorize a later mutation even if the stale inspection itself is never returned.

## Frozen F3 invariants

F3 MUST preserve all of the following.

### F3-I1 — Exclusive live ownership

Every live browser access belongs to exactly one ownership era and one control owner.

The supported owner values are conceptually:

```text
agent
human
none / transition / awaiting human
```

No agent live-browser operation may be admitted unless the agent owns the browser.

### F3-I2 — Zero agent live access without ownership

While ownership is human or no controller owns the browser, all agent-facing live-browser operations must reject before browser execution where possible.

This includes at minimum:

```text
inspectBrowser
pages
captureScreenshot
navigate
click
type
press
scroll
back
forward
switchPage
closePage
```

Control/status and historical reads remain available.

### F3-I3 — Generation-bound admission

Every admitted live browser operation belongs to one in-memory ownership generation.

Every actual ownership transition advances the generation.

Examples:

```text
agent → awaiting_human
awaiting_human → human
human → agent
agent → human
active ownership → terminal
```

Idempotent calls that do not change ownership do not advance generation.

### F3-I4 — Stale-generation results are invalid

Before a browser-derived result is:

- returned;
- persisted;
- recorded into `InteractionPolicy`;
- emitted as evidence;
- emitted as an agent-action observation;
- used to synchronize active-page state;

the operation's ownership token must still be current.

If its generation is stale, the operation fails safely and its result is discarded.

### F3-I5 — Ownership transitions close admission and drain obsolete work

A transition must establish priority over newly arriving agent browser work.

The required conceptual order is:

```text
close new admission
→ advance/invalidate ownership generation
→ drain already-admitted obsolete operations
→ complete persisted ownership transition
→ publish transition observation
→ wake control waiters
```

New operations arriving after transition start must not queue ahead of or delay the transition.

Human takeover must not starve behind a continuous stream of browser reads.

### F3-I6 — Human-to-agent return establishes fresh browser knowledge

Returning control to the agent must invalidate browser knowledge created before or during human ownership.

The required conceptual sequence is:

```text
human owns browser
→ begin return transition
→ keep agent admission closed
→ flush human activity
→ capture current page state needed for handback
→ invalidate browser target references
→ clear/require fresh F1 inspection
→ establish new agent ownership generation
→ persist controller=agent
→ publish human_returned_control
→ wake waiters
→ open normal agent browser work
```

The first inspection capable of authorizing a post-human mutation must begin and complete within the new agent ownership generation.

No pre-handoff inspection can become valid again after handback.

### F3-I7 — Historical reads remain available

The ownership fence must not block operations that do not touch the live browser.

These include:

```text
getSession
getControlStatus
waitForControl
getObservations
listEvidence
readEvidence
```

The external agent must be able to observe and wait for control precisely while it does not own the browser.

## Ownership generation

F3 introduces runtime-local, per-session ownership generations.

Conceptually:

```text
generation 1 → agent
generation 2 → awaiting human / none
generation 3 → human
generation 4 → agent
```

The generation is a synchronization primitive, not persisted business state.

Do not persist it into:

- session JSON;
- MCP protocol;
- observations;
- evidence.

Persisted ownership truth remains represented by the existing Session fields:

```text
status
controller
handoff
```

The fence synchronizes with those transitions; it must not become an independent second source of persisted ownership truth.

## Required architecture

F3 uses three mechanisms together.

### 1. Admission control

New browser work is admitted only for the current owner.

### 2. Generation fencing

Every admitted operation receives a generation-bound lease/token.

Before committing or returning browser-derived data, the lease must still be current.

### 3. Transition draining

Ownership transition closes admission first, invalidates the old ownership generation, and drains already-running browser work before presenting the new ownership state as complete.

A generic owner check, mutex, or read/write lock alone is insufficient.

## BrowserOwnershipFence

Implement under:

```text
apps/runtime/src/control/browser-ownership-fence.ts
apps/runtime/src/control/browser-ownership-fence.test.ts
```

The abstraction owns runtime-local synchronization mechanics such as:

- current ownership generation;
- current owner;
- admission-open/closed state;
- active operation count;
- generation-bound leases;
- drain completion.

The exact internal representation may evolve as long as the frozen invariants remain true.

The browser package must remain unaware of agent/human ownership semantics.

## Concurrency model

Multiple compatible agent reads may run concurrently while agent ownership is stable.

Mutations continue using `BrowserCommandCoordinator` for mutation ordering.

F3 must not turn every browser operation into one global session queue.

The intended separation is:

```text
mutation ordering
+
ownership fencing
```

Ownership transitions have priority because transition start closes admission before draining currently active operations.

## Cancellation

F3 v1 does not require force-cancellation of arbitrary Playwright operations.

The deterministic model is:

```text
fence generation
→ invalidate result
→ drain physical operation
→ complete transition
```

Lease cleanup must happen in `finally`.

Existing browser-operation timeouts remain the primary protection against pathological operations.

A transition must fail safely rather than grant ownership while obsolete browser work remains uncontrolled.

## Live-read integration

### inspectBrowser

Target flow:

```text
require active session
→ acquire agent ownership lease
→ browser.inspect
→ assert lease current
→ record inspection into InteractionPolicy
→ assert lease current
→ return inspection + pagePolicy
→ release lease
```

The first `assert current` must happen before `recordInspection()`.

### pages

`pages()` uses the same live-read fence.

Human-owned or awaiting-human sessions reject with the existing appropriate control error contract.

### screenshots

Screenshots are semantically reads even though the current implementation uses the mutation path.

F3 must generation-fence the physical screenshot and must not persist stale screenshot evidence after ownership changes.

F3 does not require concurrent screenshots if evidence serialization benefits from keeping them serialized.

## Mutation integration

Existing mutations remain ordered through `BrowserCommandCoordinator`.

The physical live-browser portion additionally executes under an ownership generation lease.

Conceptually:

```text
mutation queue admission
→ active-session check
→ ownership lease
→ F1/F2 mutation authorization
→ browser operation
→ assert generation current
→ Runtime state / observation updates
→ release lease
→ F2 post-action orchestration
```

A mutation lease must be released before ownership-changing F2 orchestration starts, otherwise the transition could wait on the operation that is trying to initiate the transition.

## OwnershipTransitionService

F3 centralizes ownership-changing mechanics under:

```text
apps/runtime/src/control/ownership-transition.service.ts
apps/runtime/src/control/ownership-transition.service.test.ts
```

It owns safe transition execution for:

- explicit `requestHuman`;
- automatic F2 human request;
- human takeover;
- return to agent;
- terminal/end-session ownership shutdown.

F2 remains authoritative for **why** automatic handoff is required.

F3 becomes authoritative for **how** ownership changes safely.

The F2 orchestrator must not directly write Session ownership state once F3 transition integration is complete.

Manual and automatic request-human flows must use the same underlying transition mechanism.

## Transition ordering

### Agent → awaiting human

```text
validate transition
→ close agent admission
→ advance/invalidate generation
→ drain active agent browser work
→ persist status=awaiting_human/controller=null/handoff
→ publish human_requested or F2-specific handoff observation
→ wake control waiters
```

After completion, no browser operation from the previous agent generation may still be active.

### Awaiting human → human

```text
validate transition
→ establish new ownership generation
→ persist controller=human/status=active
→ publish human_took_control
→ wake waiters
```

Agent admission remains closed.

### Voluntary Companion agent → human

```text
validate transition
→ close agent admission
→ advance/invalidate generation
→ drain agent browser work
→ persist controller=human
→ publish human_took_control
→ wake waiters
```

Human ownership must not be presented as active while old agent work still physically runs.

### Human → agent

```text
validate transition
→ keep agent admission closed
→ flush human activity
→ read handback page information as transition-owned browser work
→ invalidate all targets
→ require fresh F1 inspection
→ establish new agent generation
→ persist controller=agent/status=active
→ clear handoff
→ publish human_returned_control
→ wake waiters
```

A waiter that wakes after this event must see a fully usable new ownership era.

### Terminal transition

```text
close admission
→ invalidate generation
→ drain active browser operations
→ flush pending activity/evidence
→ close browser
→ release profile resources
→ clear policy/fencing state
→ persist terminal session state
→ publish terminal observation
→ wake waiters
```

No browser result from the terminated ownership era may escape afterward.

## State-transition atomicity

Transition observations describe completed ownership states.

Do not publish:

```text
human_took_control
```

until Rove actually considers the human the exclusive live-browser owner.

Do not publish:

```text
human_returned_control
```

until target invalidation, inspection invalidation, and the new agent generation are established.

Control waiters may therefore trust the state represented by the observation that wakes them.

## Existing control-state writes

Before F3, ownership transition writes exist in several locations, including:

- session initialization/terminal session handling;
- `RuntimeService.requestHuman()`;
- `RuntimeService.takeHumanControl()`;
- `RuntimeService.returnAgentControl()`;
- Runtime failure paths;
- F2 `PagePolicyOrchestrator`.

F3.5 must remove duplicated transition mechanics.

Derived state reconstruction in `ControlWaitService` is not a persisted ownership transition and must not be mistaken for a direct ownership write.

After F3.5, persisted ownership transitions should be concentrated in the transition service plus narrowly justified session initialization/terminal persistence.

## Deterministic race testing

Primary race tests must use explicit deferred gates/latches, not arbitrary `setTimeout()` timing.

Add controllable browser test primitives capable of pausing operations at known boundaries.

The mandatory adversarial race suite must cover at least:

### Race A — inspect vs request-human

A running inspect becomes stale when handoff begins.

Assert:

- result does not reach agent;
- stale inspection is not recorded;
- references cannot authorize future work;
- handoff drains the operation.

### Race B — inspect vs voluntary Companion takeover

A running inspect cannot cross agent → human ownership.

### Race C — pages vs handoff

Page enumeration receives the same protection as inspection.

### Race D — screenshot vs handoff

A stale screenshot cannot become persisted evidence.

### Race E — queued mutation behind handoff

A mutation queued behind ownership transfer must fail before browser execution.

### Race F — handoff behind active inspect

A read outside `BrowserCommandCoordinator` cannot outlive the transfer.

### Race G — human return vs stale inspect

A pre-handoff/stale generation inspection cannot become valid after a later agent generation begins.

### Race H — concurrent stable reads

Compatible reads can overlap during one stable agent generation and drain correctly.

### Race I — transition admission priority

Once transition starts, newly submitted reads reject and cannot extend drain time.

### Race J — terminal transition vs active browser work

Session completion cannot allow an old browser operation to return afterward.

Optional randomized stress coverage may supplement these deterministic tests but does not replace them.

## MCP acceptance

Through the externally visible runtime/MCP path, while human owns the browser:

```text
inspect           → blocked
pages             → blocked
screenshot        → blocked
mutations         → blocked
control status    → available
control wait      → available
historical reads  → available
```

At least one complete process/transport E2E path must prove this, with transport parity coverage where practical.

## Performance

Normal ownership admission must be an in-memory operation.

Expected mechanics are approximately:

```text
session/fence lookup
generation comparison
active-operation counter update
```

No disk access should be added solely for every fencing admission.

Do not create another persisted controller source of truth.

## Scope boundaries

F3 does not:

- redesign F1 perception;
- change F2 page-policy meaning;
- move ownership semantics into `packages/browser`;
- replace `BrowserCommandCoordinator`;
- serialize all browser reads globally;
- introduce a new package;
- broadly rewrite `RuntimeService`;
- require AbortController propagation through all browser operations;
- persist the ownership generation;
- change historical evidence/control-status availability.

Only the coherent responsibility of control transition and live-browser fencing should be extracted.

## Implementation phases

### F3.1 — Freeze invariants

This document.

### F3.2 — Unit-test BrowserOwnershipFence

Build and prove the pure in-memory fence before browser integration.

### F3.3 — Protect live read paths

Fence:

- `inspectBrowser`;
- `pages`;
- screenshot behavior.

### F3.4 — Integrate mutation operations

Generation-fence the existing mutation path while retaining `BrowserCommandCoordinator`.

### F3.5 — Centralize ownership transitions

Introduce `OwnershipTransitionService` and route all ownership-changing paths through it.

### F3.6 — Adversarial race suite

Implement deterministic races A–J.

### F3.7 — MCP E2E

Prove live-browser denial and control/status availability through transport boundaries.

### F3.8 — Full regression

Run:

```text
pnpm typecheck
pnpm lint
pnpm build
pnpm test
```

Then explicitly re-accept:

- F1 production perception;
- F1 freshness/temporal invariants;
- F2 policy/orchestration;
- M7 control integration;
- M9 human activity;
- MCP E2E;
- F4 browser/runtime integration;
- frozen F1 research hashes.

## Definition of done

F3 is complete only when all of these are true:

1. agent has zero live-browser access without agent ownership;
2. every admitted browser operation is generation-bound;
3. stale-generation browser results cannot be returned or committed;
4. ownership transitions close admission before draining old work;
5. human takeover cannot starve behind newly arriving reads;
6. handback invalidates targets and requires fresh post-human inspection;
7. manual and F2 automatic handoff share one safe transition mechanism;
8. transition observations are published only after the new ownership state is fully established;
9. historical/control reads remain usable without live-browser ownership;
10. deterministic race tests A–J pass;
11. MCP E2E proves the ownership boundary;
12. F1, F2, F4, M7, and M9 regressions remain green;
13. frozen F1 research artifacts remain byte-identical;
14. typecheck, lint, build, and whole-repository tests pass.
