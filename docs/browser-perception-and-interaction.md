# Browser Perception and Interaction

## Status

This document is the canonical implementation plan for strengthening Rove's
browser perception, browser interaction, desktop control surface, integrated
agent surface, and later generic workflow system.

Rove remains in staging. This work replaces and extends the canonical staging
implementation directly. It does not introduce a public or internal Rove
"version two" architecture, parallel browser stack, or permanent compatibility
flag.

## Baseline authority

The planning baseline is:

```text
Rove
  branch: main
  commit: 8e79270b1172b6f746712e1934e317a598d3f07c

Scry
  branch: main
  tracked commit: 0c9cf69cd91eaad1bcd2b11af0c2a8b76d676398
```

The Scry worktree contained unrelated untracked companion, integration, local
execution, and product-document work during reconciliation. Those files are not
part of this plan's evidence and must not be modified by Rove work.

## Product boundary

Rove and Scry are separate products.

Scry is a browser-based human verification and application-testing system. It
executes test instructions, records evidence, produces reports, and is intended
to cover work that would otherwise require a person to traverse and assess an
application.

Rove is a local-first browser work hub in which an agent and a human may observe
the web, perform tasks, preserve context, and transfer browser control.

Scry is relevant only because it contains browser perception and interaction
techniques that may be useful to Rove. Rove must not inherit Scry's testing
domain, mission model, reporting model, protection architecture, or historical
implementation complexity.

## Existing Rove foundation

The following Rove capabilities are existing authority and must be preserved
unless an accepted experiment proves that a bounded replacement is required:

- Rove-owned browser sessions;
- managed persistent and temporary profiles;
- system Chrome launched externally and attached through CDP;
- stable page identities;
- page revisions;
- revision-scoped target references;
- stale-target protection;
- serialized browser mutations;
- page-state perception and mutation policy;
- browser ownership fencing;
- human takeover and return of control;
- target invalidation after handback;
- sensitive-value minimization;
- screenshot masking;
- stale-screenshot persistence protection;
- evidence and observation persistence;
- Capture Mode;
- Electron Companion;
- direct and control-plane MCP adapters.

The new browser capability must compose with these systems. It must not create a
second controller, second page identity model, second evidence authority, or
second ownership state machine.

## Scry evidence hierarchy

Scry contains three different categories of source material.

### Current active browser workflow

The selected Browser V2 runtime is the current tracked execution path. It is
relevant for:

- thin command surfaces;
- durable command ownership;
- successor observations;
- distinguishing dispatch success from factual effect success;
- applied, not-applied, and unknown outcomes;
- refusal to replay possibly applied effects;
- explicit current-document reference ownership.

The Rove implementation may adapt these principles without copying Scry's
specific protected-transaction or testing contracts.

### Retained Praxis implementations

Praxis contains richer implementations and tests involving:

- native, textual, accessibility, structural, geometry, visual, and historical
  evidence;
- DOMSnapshot and accessibility-tree acquisition;
- read-only CDP sensors;
- visual anchors;
- OCR;
- capability grounding;
- confidence and ambiguity;
- target revalidation;
- typed interaction adapters;
- local-state and effect verification.

These implementations are experiment inputs. Their presence in the repository
does not prove that all of them belong on Rove's production path.

### Future-direction documents

Scry documents concerning an observation graph, interaction fabric, attached
Chrome, extensions, and sensor fusion are architectural research only. They are
not direct implementation authority for Rove.

## Decisions

The following decisions govern all phases.

1. Playwright remains Rove's browser-action authority.
2. CDP may provide bounded internal observations and diagnostics.
3. Raw CDP commands are never exposed as a general agent tool.
4. Semantic, accessibility, geometry, OCR, vision, runtime, and historical facts
   are evidence; none independently authorizes an action.
5. Every action uses current Rove page and ownership authority.
6. A stale semantic reference, screenshot, visual anchor, or coordinate fails.
7. Existing Rove protection and human-control behavior remains.
8. No additional Scry-derived protection subsystem is introduced.
9. Microsoft Playwright MCP is not Rove's controller.
10. Codex integration uses Codex App Server directly, not the Codex SDK.
11. Job discovery and GitHub catch-up remain user-authored workflows, not
    hard-coded product modules.
12. Rove maintains one canonical staging implementation rather than old and new
    browser stacks.
13. An experiment is a gate inside a phase, not a separately delivered subphase.
14. Implementation complexity is accepted only when measured capability requires
    it.

## Experiment policy

An isolated experiment is required when:

- technical feasibility is uncertain;
- two materially different implementations are plausible;
- browser or operating-system behavior may invalidate the design;
- latency, payload, image, or model cost may invalidate the design;
- a new production abstraction would be expensive to reverse;
- a technique succeeded in Scry but its value to Rove remains unproven.

An isolated experiment:

- uses the smallest representative system;
- may use JavaScript, Python, or another faster implementation language;
- normally lives under `/private/tmp`;
- does not need production layering or abstractions;
- includes representative adversarial fixtures;
- records measurements and failures;
- ends with adopt, modify, or reject;
- does not enter production by copying the prototype;
- must not remain merely because implementation effort has already been spent.

Ordinary controllers, schemas, persistence wiring, UI wiring, and deterministic
plumbing do not require an experiment unless a material uncertainty appears.

## Phase 1 — Unified browser perception

### Outcome

At completion, an agent receives one authoritative browser observation that
describes both the semantic page structure and its relevant visible geometry.

### Production scope

Phase 1 includes:

- one canonical `BrowserObservation` contract;
- session, page, revision, and document correlation;
- hierarchical semantic structure;
- accessibility evidence where useful;
- first-class target geometry;
- frame and open-shadow-root provenance;
- viewport dimensions;
- device scale;
- scroll position;
- clipping and bounded occlusion evidence;
- viewport screenshots;
- target screenshots;
- region screenshots;
- actual image content returned to compatible agents;
- durable screenshot evidence;
- screenshot-to-observation correlation;
- capability reporting for each browser provider;
- bounded text, structure, target, and image output;
- preservation of page-state policy and human handoff.

Interactive controls are acquired into one revision-scoped internal index.
Fast DOM discovery remains the primary source; Playwright accessibility roles
are recovery evidence for DOM-backed controls the primary source misses.
Recovered controls do not create
an action shortcut: they pass through the same classifier, identity builder,
geometry validation, registry, and `TargetReference` resolver as primary
controls. Inspection emits bounded coverage counts and bounded exclusion
reasons so a visible supported semantic control cannot silently disappear.
Presentation limits only truncate the returned inventory; grounding against the
same exact observation continues to use its complete canonical index.

### Isolated experiment

One experiment campaign compares:

```text
current bounded DOM inspection
        versus
DOM inspection plus Playwright accessibility representation
        versus
DOM inspection plus bounded CDP AX/DOMSnapshot augmentation
```

It must test:

- actual image transport through an agent-facing result;
- image decoding by the receiving client;
- durable evidence storage;
- viewport and target capture;
- screenshot masking;
- CSS-pixel to image-pixel correlation;
- ordinary scrolling;
- device scale factor changes;
- nested iframe controls;
- open shadow DOM;
- duplicate controls;
- covered controls;
- document replacement;
- handoff during screenshot acquisition;
- managed Playwright mode;
- externally launched Chrome attached through CDP;
- latency and payload measurements.

The experiment selects the smallest strategy that supplies sufficient
incremental information. It must not assume that the richest source combination
is automatically best.

### Acceptance

Phase 1 is accepted only when:

- current browser, runtime, policy, control, and evidence tests remain green;
- image content reaches a compatible agent;
- screenshots remain durable evidence;
- semantic targets and visual bounds share one current observation authority;
- stale visual observations cannot authorize later actions;
- stale screenshots cannot be persisted after ownership changes;
- secret-field masking remains;
- browser-provider limitations are explicit;
- observation payloads and latency have recorded release budgets;
- the rejected observation strategies are not retained in production.

### Exclusions

Phase 1 excludes:

- OCR;
- model-vision routing;
- confidence scoring;
- contextual target intent;
- successor-action verification;
- browser-following desktop controls;
- Codex App Server;
- generic workflows;
- scheduling and notifications.

## Phase 2 — Grounded and verified interaction

### Outcome

At completion, Rove resolves an intended control using contextual evidence,
detects ambiguity, performs the interaction through Playwright, observes the
result, and reports the factual outcome.

### Production scope

Phase 2 includes:

- target capability intent;
- form, dialog, card, row, and region scope;
- structural relationships;
- candidate alternatives;
- ambiguity reporting;
- confidence and runner-up separation where experiment evidence supports it;
- immediate pre-action revalidation;
- hover;
- clear and fill;
- select;
- check and uncheck;
- drag and drop;
- upload;
- precise scroll;
- dialog handling;
- popup and tab handling;
- bounded coordinate fallback;
- successor observations;
- expected effects;
- action receipts;
- applied, not-applied, and unknown outcomes;
- prohibition of blind consequential-action replay.

Ordinary `browser.type` and verified `fill` mean deterministic replacement of
the complete contents of an input, textarea, or contenteditable. Rove uses
Playwright `fill`, verifies the exact resulting editable value without
serializing it, and reports failure rather than falling back to sequential key
events. Explicit keyboard behavior is a separate `browser.press` operation.

### Isolated experiment

A compact adversarial corpus compares current target selection with contextual
multi-evidence grounding. It includes:

- duplicate labels;
- controls in separate forms;
- a re-rendered target;
- a covered target;
- asynchronous controls;
- iframe and shadow controls;
- canvas-only interaction;
- delayed visible confirmation;
- post-dispatch connection loss;
- an unknowable remote outcome.

### Acceptance

Phase 2 is accepted only when:

- Playwright remains the only action dispatcher;
- every fallback remains tied to a current observation;
- ambiguity is represented rather than guessed away;
- dispatch success is not treated as automatic task success;
- successor observations are available;
- unknown consequential outcomes cannot be retried automatically;
- human control behavior remains unchanged.

## Phase 3 — Agent-visible visual perception

### Status

Accepted on 2026-09-05 after the mandatory isolated caller-visible visual
evidence experiment passed every frozen success threshold.

The existing Phase 1 screenshot path is adopted as Phase 3's visual-evidence
transport. Phase 2 remains the browser action authority. No additional Phase 3
production browser implementation is required for caller-visible visual
perception.

The durable qualification record is:

`docs/browser-perception-and-interaction-phase3-qualification.md`

OCR, an internal multimodal model and a second visual-perception subsystem
remain outside Phase 3.

Research-realigned after completion of Phases 1 and 2.

Phase 3 does not create a second browser perception system. Phase 1 already
implemented observation-correlated screenshots and bounded MCP image delivery,
while Phase 2 already implemented grounded target resolution, Playwright-owned
interaction, successor observations, action receipts and unknown-outcome
handling.

The Phase 3 entry question is therefore narrower:

> Can a compatible vision-capable calling agent actually consume and reason
> over the visual evidence already returned by Rove, and can that reasoning
> improve browser understanding without creating a second action authority?

### Complete phase outcome

At the end of Phase 3, a compatible vision-capable calling agent can request a
current bounded screenshot from Rove, actually receive that image in model
context, use it to understand rendered state, and continue through Rove's
existing target-resolution and verified-interaction contracts.

Rove continues to own:

- session and page identity;
- document and revision identity;
- ownership generation;
- target identity;
- target freshness;
- Playwright interaction dispatch;
- successor observations;
- expected-effect verification;
- `ActionReceipt`;
- consequential replay fencing;
- human-control transitions.

The calling agent owns interpretation of the image.

A screenshot is evidence. It is never independent action authority.

### Existing production capability reused by Phase 3

Phase 3 reuses the existing `browser.screenshot` contract.

Supported capture modes already are:

- viewport;
- full-page;
- target;
- region.

An `observationId` may bind a capture to one exact current
`BrowserObservation`.

Viewport and bounded region captures can already be returned through MCP as
actual image content while the same capture remains durable Rove evidence.

Phase 3 must qualify this existing path before adding another visual transport
or screenshot tool.

### Intended normal path

```text
BrowserObservation
    ↓ sufficient
continue semantically

BrowserObservation
    ↓ rendered meaning remains unclear
browser.screenshot
    ↓
same calling agent inspects image
    ↓
agent chooses current intent / current target
    ↓
browser.resolve_target when grounding is needed
    ↓
browser.interact
    ↓
Playwright
    ↓
successor observation
    ↓
ActionReceipt
```

The caller decides when visual evidence is useful. Rove does not need an
internal model or an automatic model-routing layer merely to decide whether the
agent should look at a screenshot.

### Visual target disambiguation

When the structured observation contains plausible alternatives that remain
ambiguous, the caller may request a viewport, target or region screenshot and
use that image to decide which current Rove target best matches its intent.

The caller must still return or select a current `TargetReference`.

The screenshot itself does not manufacture a new action target.

A stale screenshot cannot revive a stale target.

### Existing coordinate interaction

Phase 2 already includes a `coordinate_click` interaction.

Its current protocol requires:

- a current `TargetReference`;
- an exact `observationId`;
- finite `offsetX` and `offsetY` values.

Those requirements make the operation target- and observation-scoped, but the
protocol schema alone does not prove that the offsets are constrained to remain
inside the target bounds.

Phase 3 therefore does not treat `coordinate_click` as already-qualified
visual-only action authority.

Before this primitive could be used for a genuine canvas or image-only
interaction, an isolated experiment must prove that the production dispatch
path:

- preserves the exact current target and observation authority;
- rejects stale page, document and ownership state;
- constrains the effective click to the intended current visual surface; and
- cannot escape that surface through arbitrary offsets.

Until those properties are proven, visual-only mutation remains a human-control
case.

Phase 3 must not expose unrestricted page coordinates or raw CDP action
dispatch.

### Mandatory isolated experiment

Before any Phase 3 production browser change, one disposable experiment must
qualify the existing screenshot path with the actual intended calling-agent
client.

The experiment hypothesis is:

> A screenshot captured by the existing Rove/Playwright path can reach the
> calling vision-capable agent as actual visual context, the agent can
> demonstrate that it saw pixel-only information, and visual reasoning can
> assist understanding without bypassing current Rove target authority.

The experiment must use content whose answer exists only in rendered pixels,
not in ordinary DOM or accessibility text.

A representative fixture should contain:

- a randomized visual nonce drawn into a canvas;
- two randomized shapes whose spatial relationship changes per run;
- one visually rendered label that is absent from semantic page text;
- an ordinary semantic control elsewhere on the page.

The caller must correctly report:

- the nonce;
- the spatial relationship;
- the rendered label.

The experiment must separately prove that the agent cannot use that image to
bypass the normal target contract for the semantic control.

### Client/transport qualification

Image transport is considered qualified only when the actual supported caller
can reason about the delivered image.

The experiment must record:

- MCP client and version;
- calling model;
- transport used;
- image response shape;
- capture mode;
- MIME type;
- encoded byte length;
- screenshot dimensions;
- evidence ID;
- source observation ID;
- whether the model demonstrably saw the pixel-only nonce;
- whether the spatial answer was correct;
- whether the rendered label was correct.

Byte-valid PNG transport alone is not sufficient evidence that the model saw
the image.

A client that does not surface the image to the model is reported as
`visual_delivery_unverified`. Rove must not pretend that such a client supports
agent-visible screenshots.

### Success threshold

The selected image response shape is accepted only if the intended supported
caller achieves, across at least ten randomized runs:

- 10/10 correct visual nonces;
- 10/10 correct spatial relationships;
- 10/10 correct rendered labels;
- exact observation-to-evidence correlation;
- no silent image drop;
- no stale observation accepted after page mutation or ownership change.

Failure holds Phase 3 production implementation at the experiment gate.

### Optional focused-disambiguation comparison

Only after end-to-end caller vision is proven should the experiment compare:

1. semantic observation only;
2. semantic observation plus viewport screenshot;
3. semantic observation plus focused region screenshot.

This comparison should use deterministic fixtures with duplicate labels,
visually distinct controls, dense layouts, frames, occlusion and deliberately
unresolvable cases.

A focused screenshot enters any additional production guidance only if it
reduces ambiguity or incorrect target choice without weakening abstention.

No annotated Set-of-Mark system is assumed necessary.

### OCR decision

OCR is excluded from the immediate Phase 3 production path.

Phase 3 does not add:

- Tesseract;
- OCR language data;
- a local OCR provider interface;
- a remote OCR service;
- a generic visual-provider abstraction.

OCR remains a future hypothesis only.

It may be reconsidered if real workflows demonstrate recurring cases where:

- required text exists only in pixels;
- the calling client cannot consume images;
- vision-capable callers repeatedly fail to localize small rendered text; or
- deterministic text boxes provide proven incremental value.

Any future OCR implementation requires a new isolated experiment against those
observed failures. Existing production code must not be shaped around a
speculative OCR provider.

### Model-vision decision

Rove does not own a model-vision provider.

No internal multimodal model, model router, extra inference service or visual
model API is part of Phase 3.

"Vision" in this architecture means the existing visual capability of the same
agent already calling Rove.

### Visual verification

Phase 2 remains authoritative for action outcome.

A screenshot may later provide supporting evidence for rendered-state
verification, but a pixel change alone must never become business success.

The existing outcomes remain:

- `applied`;
- `not_applied`;
- `unknown`.

Missing or contradictory successor evidence remains unresolved or unknown as
defined by Phase 2.

Consequential unknown outcomes remain non-replayable under their stable
`consequenceKey`.

### Security and privacy boundary

Visual content is untrusted page evidence.

Text or instructions appearing in screenshots must not:

- change Rove's tool authority;
- expand workflow scope;
- create new target authority;
- bypass ownership;
- bypass stale-reference checks;
- override approval or consequential-action rules;
- automatically become durable workflow instructions or memory.

Existing screenshot masking and ownership-generation freshness remain
authoritative.

### Explicit exclusions

Phase 3 does not include:

- an internal vision model;
- a model-vision provider;
- OCR;
- OCR provider abstractions;
- automatic screenshots on every observation;
- full-page OCR;
- unrestricted coordinate clicking;
- raw CDP mutation;
- screenshot-derived action authority;
- CAPTCHA solving;
- a browser extension;
- a second browser architecture;
- a Set-of-Mark implementation by default;
- workflow memory derived automatically from screenshot content.

### Acceptance boundary

Phase 3 is accepted when:

- the existing Phase 1 and Phase 2 contracts remain green;
- the actual intended calling agent demonstrably receives image content;
- pixel-only randomized evidence is read correctly across the required runs;
- screenshot evidence is correlated to its exact source observation;
- stale screenshot/observation authority fails closed;
- normal semantic pages require no automatic screenshot;
- the caller may use visual evidence to inform current target selection without
  bypassing `TargetReference`;
- no new unrestricted coordinate authority exists;
- no OCR dependency or speculative OCR abstraction is introduced;
- no internal model-vision dependency is introduced;
- the experiment records an explicit adopt, modify or reject decision for any
  optional visual mechanism;
- production changes, if any, are limited to gaps actually demonstrated by the
  experiment.

## Phase 4 — Browser-following compact control surface

### Outcome

At completion, the user can take, return, pause, stop, expand, or reposition
Rove on the Rove-owned browser without locating a separate companion window. This includes
the owned browser's native fullscreen working context: fullscreen must not hide
Rove or require a macOS Space/window switch for immediate control.

### Production scope

Phase 4 includes:

- frameless compact Electron surface;
- universal `64 x 56` micro and `360 x 240` expanded states;
- fullscreen micro and fullscreen-expanded states;
- association with the active Rove browser window;
- browser movement and resize following;
- monitor changes;
- minimized and foreground behavior;
- semantic main-process-validated dragging within eligible display bounds;
- exact owned-browser foreground PID arbitration on macOS, Windows, and
  Linux/X11;
- agent-working state;
- human-required state;
- human-controlling state;
- paused state;
- ready-for-review state;
- Take Control;
- Return Control;
- Pause;
- Stop;
- Open Rove;
- tray and full-companion fallback.

A browser extension is not required for Rove-owned browser windows. Page
injection is prohibited.

### Isolated experiment

A disposable Electron and Chrome experiment must prove:

- browser-window identity;
- bounds retrieval;
- movement and resize following;
- maximized behavior;
- multiple monitors;
- focus preservation;
- foreground hiding;
- fullscreen-Space visibility scoped to the exact owned browser's fullscreen
  state;
- restart recovery;
- graceful fallback when platform window tracking is unavailable.

### Status

Implementation complete on 2026-09-05, with a post-acceptance fullscreen
product-requirement correction and a direct-testing universal-micro correction
the same day. The production design retains CDP as
the browser-window authority and Electron `screen` as the display-topology
authority. All desktop platforms use a `64 x 56` top-right micro presentation,
expand in place to `360 x 240`, accept only main-process native cursor geometry,
and hide whenever the exact owned browser is not the native foreground process.
macOS additionally scopes fullscreen-Space visibility to authoritative
fullscreen state. Leaving fullscreen restores micro sizing from a fresh
controller decision. The
native follower, ownership controls, desktop packaging, and available live
paths are qualified in
[`browser-perception-and-interaction-phase4-qualification.md`](./browser-perception-and-interaction-phase4-qualification.md).

Windows live desktop execution, Linux Wayland execution, and physical
multi-monitor execution remain external qualification gaps because those
environments were not available on the qualification host. They are not
recorded as passes.

## Phase 5 — Codex App Server integration

### Outcome

At completion, the Rove desktop application contains an integrated Codex
conversation and reasoning surface.

### Production scope

Phase 5 includes:

- direct `codex app-server` supervision;
- JSON-RPC client;
- initialization;
- official ChatGPT login;
- account state;
- thread start, list, resume, and archive where required;
- turn start;
- streamed events;
- interruption;
- approval handling;
- model and rate-limit state where available;
- Rove tool registration;
- Rove task, browser-session, and Codex-thread association;
- App Server crash recovery;
- continued support for external MCP clients.

The Codex SDK is outside scope.

### Isolated experiment

A minimal App Server client must prove:

- initialization;
- account read;
- official login initiation;
- thread creation;
- thread resumption after client restart;
- streamed turn events;
- interruption;
- one real Rove tool call;
- approval request and response;
- App Server restart behavior.

### Authority boundary

Codex reasons and chooses tools. Rove owns browser lifetime, observation,
interaction, evidence, human control, and browser-session truth. Codex must not
open a competing browser for the same Rove task.

## Phase 6 — Basic generic workflows

### Outcome

At completion, a user can manually define a reusable workflow, run it, and
return to persisted findings and prepared work.

### Production scope

Phase 6 includes:

- workflow objective;
- workflow instructions;
- optional structured inputs;
- manual execution;
- run state;
- run history;
- evidence references;
- findings;
- prepared actions;
- generic review items;
- retain, dismiss, and complete states;
- rerun;
- association with a Codex thread;
- association with a Rove browser session.

Job discovery and GitHub catch-up may be used as acceptance workflows. They are
not separate product modules or database models.

### Exclusions

Phase 6 excludes:

- domain-specific Job Scout architecture;
- domain-specific GitHub Watch architecture;
- workflow skills;
- preference learning;
- methodology packs;
- Telegram;
- outbound email;
- draft-email integration;
- file-delivery destinations;
- complex schedules;
- event triggers;
- workflow dependency graphs;
- shared or marketplace workflows.

## Later workflow ecosystem

The later generic workflow ecosystem may add independently composable layers:

```text
objective
context
method
memory
trigger
destination
run
review
```

Examples include:

- durable job-selection preferences that cannot be expressed fully in one
  instruction;
- user corrections, accepted findings, rejected findings, and inferred
  preference evidence;
- reusable workflow skills or methods;
- manual, scheduled, and event-driven triggers;
- Telegram notifications;
- email drafts;
- outbound email with explicit authority;
- uploads to selected destinations;
- workflow composition;
- reusable templates.

These concerns must remain generic and isolated from the browser runtime. Their
final product form and differentiation remain open research questions.

## Implementation process

Every implementation phase follows:

```text
exact repository baseline
    -> bounded reconciliation
    -> isolated experiment where required
    -> adopt, modify, or reject
    -> one cohesive production implementation
    -> targeted qualification
    -> repository-wide qualification
    -> diff and ownership audit
    -> acceptance
```

A phase may require more than one terminal command because experiment,
production mutation, and qualification must remain distinguishable. It still
has one outcome and one acceptance boundary.

Commands must:

- assert expected repository and HEAD;
- preserve unrelated work;
- avoid fetch, push, and commit unless explicitly requested;
- print changed files;
- print qualification results;
- print the exact stop point;
- avoid permanent prototype code;
- remove superseded staging implementations rather than retaining parallel
  authority.

## Phase 1 experiment decision

The isolated Phase 1 experiment passed.

The selected production strategy is:

```text
Playwright ARIA snapshot
    + existing Rove DOM semantics
    + Playwright target geometry
```

The experiment proved the required semantic hierarchy, duplicate-control scope,
open-shadow perception, frame-bound controls, target geometry, basic occlusion,
DPR-aware screenshot correlation, stale-capture rejection, attached Chrome
compatibility, and MCP image transport.

The bounded CDP AX/DOMSnapshot candidate also passed the experiment corpus, but
added no required capability over the smaller Playwright strategy and therefore
does not enter the Phase 1 production path.

Phase 1 reuses existing page revision authority and binds each browser
observation to URL, material mutation version, viewport, scroll position, and
device scale.

Production bounds:

- ARIA structure defaults to 12,000 characters and is capped at 30,000;
- target inventory remains 200 by default and 500 maximum;
- visible text remains 20,000 characters by default and 50,000 maximum;
- inline screenshot presentation is capped at 2 MiB of raw PNG bytes;
- full-page capture remains durable evidence rather than guaranteed inline
  content;
- live editable values and snapshot URLs are redacted before ARIA structure is
  agent-visible.

## Immediate next gate

Qualify and audit the complete Phase 1 production implementation. CDP
AX/DOMSnapshot, OCR, model vision, compact controls, Codex App Server, and
workflow-domain behavior remain outside Phase 1.
