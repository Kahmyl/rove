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

## Phase 3 — Adaptive visual escalation

### Outcome

At completion, Rove handles relevant content that cannot be understood reliably
through ordinary semantic and accessibility channels.

### Escalation order

```text
semantic structure
    -> geometry and hit testing
    -> target or region screenshot
    -> region-first OCR
    -> model vision
```

### Production scope

Phase 3 includes:

- explicit escalation policy;
- local OCR provider interface;
- bounded OCR regions;
- OCR confidence and bounds;
- visual anchors;
- canvas and image-surface handling;
- model-vision provider interface;
- visual verification;
- evidence provenance;
- warm-provider and cancellation strategy where measurements justify it;
- latency, image, memory, and model-context budgets.

### Isolated experiment

The same fixed corpus compares:

1. semantic structure;
2. structure plus geometry;
3. structure, geometry, and screenshot;
4. structure, geometry, and OCR;
5. structure, geometry, and model vision.

The comparison records success, incorrect-action rate, ambiguity, latency,
memory use, image size, and model cost. Only channels with demonstrated
incremental value enter production.

### Acceptance

Phase 3 is accepted only when:

- ordinary semantic pages remain on the inexpensive path;
- OCR is region-first;
- visual providers are replaceable;
- temporary OCR and visual artifacts are bounded;
- visual evidence does not bypass freshness or action authority;
- every admitted provider has recorded value and cost.

## Phase 4 — Browser-following compact control surface

### Outcome

At completion, the user can take, return, pause, stop, or expand Rove beside the
Rove-owned browser without locating a separate companion window.

### Production scope

Phase 4 includes:

- frameless compact Electron surface;
- collapsed and expanded states;
- association with the active Rove browser window;
- browser movement and resize following;
- monitor changes;
- minimized and foreground behavior;
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
- restart recovery;
- graceful fallback when platform window tracking is unavailable.

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

## Immediate next gate

No production behavior changes are authorized yet.

The next gate is the Phase 1 isolated experiment. Its first result must determine
the smallest observation strategy that can provide:

- usable semantic hierarchy;
- correlated geometry;
- model-viewable screenshots;
- current observation authority;
- acceptable cost across both Rove browser modes.
