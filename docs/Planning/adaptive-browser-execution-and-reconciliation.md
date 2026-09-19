# Adaptive Browser Execution and Reconciliation

**Status:** Active implementation plan  
**Authority:** Derived from the Product Direction and browser/capability engineering contracts. This document sequences work; it does not override those contracts or claim implementation.

## Why this work exists

Rove already has strong browser foundations: task-owned page groups, exact task/page authority, fresh target grounding, structural perception, screenshots, human takeover/return, consequence identities, durable receipts/effect journals, dispatch-versus-outcome separation, and replay fencing.

Manual use exposed a different class of problem. The browser can execute an authorized mutation correctly yet fail to establish the intended outcome because the reasoning agent is asked to choose low-level verification predicates whose evidence limits are specific to Rove's current observation representation.

The September 2026 Google Drive acceptance journey is the motivating regression case. Before the folder-creation commit, the page observation already reported truncated page text and truncated target exposure. The consequential action was nevertheless verified with whole-page text presence. Dispatch completed and Runtime correctly fenced replay, but the effect remained unresolved because the chosen proof could not be authoritative over the truncated observation.

The desired correction is not a Google Drive rule. It is a cohesive browser execution model that normally works on an unfamiliar web application without engineering that application specifically.

## Settled direction

The target browser relationship is:

```text
User intent
    ↓
Codex reasoning
    ↓
Adaptive browser capability
    ├── perceive current state
    ├── choose a grounded interaction
    ├── dispatch through authority/safety checks
    ├── inspect the resulting state
    ├── escalate perception when evidence is insufficient
    ├── reconcile uncertain effects through read-only work
    └── request human participation at a genuine boundary
    ↓
Outcome truth
    ├── confirmed
    ├── not applied / failed
    └── genuinely unresolved
```

The existing authority and safety kernel remains underneath:

```text
Task/page ownership
Grants and approvals
Fresh grounding
Consequence identity
Single-dispatch boundary
Replay fencing
Durable receipts and evidence
Service/security policy
```

Adaptive execution is an orchestration responsibility inside the browser capability. It is **not** a second autonomous agent framework and does not replace Codex as the reasoning engine.

## Principles

1. **Outcome-oriented reasoning.** Codex should reason primarily about what must become true for the user's task, rather than programming low-level verification predicates as though they were application semantics.
2. **Progressive perception.** Prefer structured/semantic state when sufficient, then deepen observation only when evidence or coverage requires it.
3. **Known incompleteness is actionable information.** Truncation, target limits, ambiguous structure, stale state, and insufficient visual context should influence the next observation strategy before dispatch and during reconciliation.
4. **Mutation and reconciliation are separate.** A consequential effect may be dispatched once and remain unverified while read-only reconciliation continues.
5. **No uncertainty replay.** Reconciliation never repeats the consequential mutation, changes transport to disguise a retry, or widens authorization.
6. **Evidence can come from a different read surface than the commit surface.** The authoritative place to prove an outcome may be a refreshed list, search result, detail view, history/activity surface, persisted download evidence, or another permitted observation.
7. **Visual perception complements structure.** Screenshots/vision are ordinary escalation tools when structure is inadequate; they are not a last-resort website-specific patch.
8. **General capability correction over site rules.** Keep regression cases from real applications, but repair reusable perception/action/reconciliation families.
9. **Truth over apparent progress.** A successful click is not a confirmed external effect; incomplete evidence remains incomplete.
10. **Preserve the good foundations.** Page ownership, scoped coordination, approval binding, consequence identity, durable receipts, and replay fencing are retained unless contrary evidence emerges.

## Documentation impact

The canonical documentation has been reconciled before implementation:

- Product Direction defines adaptive browser quality and read-only reconciliation.
- Platform Policy distinguishes mutation replay from evidence gathering.
- Product Operating Model clarifies Checking outcome versus Outcome unclear.
- Logical Domain Model treats reconciliation as part of operation truth.
- System Architecture places adaptive browser execution above low-level Runtime primitives.
- Application and Capability Contracts define outcome-oriented browser reconciliation.
- Browser Control and Recording defines progressive perception and post-dispatch reconciliation.
- Structured Results and Actions keeps customer action state tied to evidence rather than low-level predicates.
- Events and Live State carries reconciliation without adding a second lifecycle authority.
- Testing and Operations requires cross-application and reconciliation qualification.
- Implementation Status records the current browser gap as partial until evidence closes it.

Documents whose existing boundaries remain valid do not need speculative edits: workflow portability, provider choice, local data portability, recording scope, and repository convergence.

## Current implementation assumptions to verify

Before changing behavior, re-establish the exact source seams for:

- browser observation construction and coverage/truncation metadata;
- target resolution and freshness;
- `browser.interact` request/receipt semantics;
- expected-effect evaluation and immediate successor inspection;
- effect-journal persistence and consequence fencing;
- semantic transaction begin/advance/verify behavior;
- screenshot acquisition and how visual evidence reaches Codex;
- task-engine `read_truth` / `correlate_receipt` patterns that may be reusable;
- MCP/browser-route instructions that currently expose verification mechanics to Codex.

Do not assume that all of these require redesign. Prefer adapting existing seams where ownership remains correct.

## Work sequence

### 1. Establish the browser execution map

Produce a code-level map from agent request through MCP, Runtime dispatch, observation, effect verification, journal persistence, and customer action projection.

Classify each responsibility as:

- reasoning/orchestration;
- authority/safety;
- perception;
- action execution;
- evidence persistence;
- outcome reconciliation;
- presentation.

The output of this investigation should identify where low-level verification planning currently leaks into Codex-facing behavior.

**Stop condition:** the team can trace an ordinary reversible interaction, a consequential mutation, and a semantic transaction end to end without guessing which component owns outcome truth.

### 2. Define the outcome/reconciliation contract

Specify the smallest internal contract needed to separate:

- intended outcome;
- dispatch truth;
- immediate evidence;
- reconciliation state;
- terminal outcome.

Do not commit prematurely to a public tool name or database schema. Determine whether existing `ActionReceipt`, operation records, and effect journals can carry the required truth with additive fields or projections.

The contract must allow:

```text
not dispatched
possibly/dispatched + unverified
reconciling through read-only evidence
confirmed
not applied / failed
genuinely unresolved
```

**Stop condition:** an ordinary browser mutation can remain safely non-repeatable while later read-only evidence is still allowed to settle it.

### 3. Make perception adaptive

Use observation metadata as control input rather than diagnostics only.

At minimum, the browser capability must be able to respond to:

- truncated text;
- truncated/excluded targets;
- virtualized or off-screen content;
- ambiguous semantic structure;
- asynchronous loading/busy state;
- state visible only in another page region or view;
- structural evidence insufficient for visual-only controls.

Candidate escalation mechanisms include targeted/scoped inspection, higher or differently bounded observation, scroll/search, fresh observation after settling, screenshot/vision, and read-only navigation to an authoritative view.

The implementation should choose the cheapest reliable evidence route; no mandatory paid perception service is introduced.

**Stop condition:** known observation incompleteness can cause a deliberate perception escalation instead of silently producing a verification predicate the observation cannot prove.

### 4. Reduce verifier programming in the Codex-facing contract

Review the agent-facing browser tools and instructions. Preserve exact grounding and authorization inputs that the model genuinely must supply, but move implementation-specific verification selection behind the browser capability where possible.

The agent may still provide outcome information when it materially improves correctness. It should not have to understand that, for example, a whole-page text predicate becomes unusable whenever Rove's own page-text representation is truncated.

Compatibility can be maintained temporarily while old and new paths coexist, but there must be one authority for dispatch/outcome truth.

**Stop condition:** representative tasks can be expressed in outcome terms without Codex manually selecting brittle proof primitives for every consequential interaction.

### 5. Generalize post-dispatch reconciliation

Add a bounded read-only path for an existing consequential operation whose mutation has already crossed the dispatch boundary.

Reconciliation may:

- fresh-inspect;
- wait for bounded convergence;
- inspect a target/scope;
- search or navigate to a read-only authoritative view;
- use screenshot/visual evidence;
- correlate durable browser/download/effect evidence;
- request human reconciliation when machine evidence cannot settle the effect.

It may not:

- dispatch the mutation again;
- reuse the consequence key through another transport;
- change authorization/material;
- interpret unrelated or pre-existing state as causal proof.

Where semantic transactions already support later destination verification, reuse or converge that machinery rather than creating competing semantics.

**Stop condition:** the motivating create-folder scenario can preserve one-dispatch safety while still reaching confirmed/not-applied when later authoritative evidence exists.

### 6. Align specialized and ordinary browser work

Review semantic transactions, upload/download evidence, navigation/history, task-result action plans, and ordinary interactions against the common model.

Keep specialized APIs only where their domain genuinely needs additional identity or multi-resource coordination. Common perception, settlement, evidence, and uncertainty semantics should not diverge accidentally.

**Stop condition:** the browser has one coherent meaning for dispatch, evidence, reconciliation, and unresolved outcome across ordinary and specialized operations.

### 7. Qualify generalization

Extend qualification around capability families rather than named websites.

Required evidence includes:

- structured-only success where structure is complete;
- automatic escalation when text/target coverage is truncated;
- visual escalation where accessible structure is insufficient;
- asynchronous state convergence;
- virtualized-list create/rename/move/remove outcomes;
- effect proof available in a different read surface from the commit surface;
- unknown immediate receipt later reconciled without mutation replay;
- genuine unresolved outcome where no authoritative evidence exists;
- human takeover/return during or after reconciliation;
- cross-task ownership and shared-host coordination unchanged.

Retain a sanitized regression reproducing the Drive failure shape without making live Google Drive a required deterministic test dependency. Use separately authorized live journeys only as additional acceptance evidence.

Measure unnecessary actions, observation/model volume, latency, and reconciliation depth so adaptability does not become uncontrolled wandering.

**Stop condition:** several unrelated application patterns pass through the same browser capability without site-specific execution rules.

### 8. Remove obsolete contract leakage

After the new path is qualified:

- remove or demote obsolete Codex-facing instructions that require low-level verification programming;
- keep compatibility identifiers only where installed data/protocol readers require them;
- update Implementation Status from actual evidence;
- update the capability atlas and regression fixtures;
- run the full repository and packaged-app qualification appropriate to the changed compatibility set.

Do not remove safety checks merely because higher-level orchestration becomes more capable.

## Verification requirements for every implementation slice

Every slice must preserve:

- exact task/page ownership;
- human takeover and return semantics;
- stale-grounding refusal;
- authorization/grant boundaries;
- one-dispatch consequence fencing;
- no alternate-route replay;
- truthful `confirmed` / `failed` / `unresolved` distinctions;
- local persistence/restart safety for any newly durable reconciliation truth;
- unrelated-task usability;
- bounded resource use.

A change that improves one website while weakening these invariants is not accepted.

## Explicit non-goals

This work does not authorize:

- a Google Drive-specific adapter;
- website-specific selectors or rule packs as the primary strategy;
- a second autonomous planning/model framework;
- mandatory hosted browsers;
- mandatory paid vision/perception APIs;
- disabling consequence fencing to make tasks appear successful;
- treating screenshots as proof without task/page/time grounding;
- broad network interception or unbounded payload retention;
- workflow-sync, identity, or recording redesign unrelated to browser execution.

## Completion condition

This plan is complete when the canonical contracts are implemented and qualified such that an unfamiliar browser task can normally be handled through adaptive structured/visual perception, grounded action, safe one-dispatch semantics, and read-only outcome reconciliation without requiring new website-specific engineering.

At that point, remaining failures should be classifiable as a concrete unsupported browser capability, a hard human/security/service boundary, or a bounded defect—not merely another consequence of the browser agent being forced to guess Rove's verifier internals.
